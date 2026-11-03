import os, base64, io, secrets, hashlib
from datetime import datetime, timedelta, timezone
from typing import Optional, Literal
from bson import ObjectId
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Depends, Header, status, File, Form, UploadFile, Response
from fastapi.middleware.cors import CORSMiddleware
from jose import jwt, JWTError
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr, Field
from pymongo import MongoClient, ASCENDING
from cryptography.fernet import Fernet, InvalidToken
from PIL import Image, UnidentifiedImageError

load_dotenv()
MONGO_URI = os.getenv("MONGODB_URI", "mongodb://127.0.0.1:27017")
DB_NAME = os.getenv("MONGODB_DB", "AttendX")
JWT_SECRET = os.getenv("JWT_SECRET", "CHANGE_ME_BEFORE_USE")
JWT_EXPIRE = int(os.getenv("JWT_EXPIRE_MINUTES", "720"))
pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")

client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=4000)
db = client[DB_NAME]

app = FastAPI(title="AttendX API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"]
)

def now():
    return datetime.now(timezone.utc)

def oid(value):
    try:
        return ObjectId(value)
    except Exception:
        raise HTTPException(400, "Invalid ID")

def clean(doc):
    if not doc: return None
    out = {}
    for k, v in doc.items():
        if k == "_id": out["id"] = str(v)
        elif isinstance(v, ObjectId): out[k] = str(v)
        elif isinstance(v, datetime): out[k] = v.isoformat()
        elif isinstance(v, list): out[k] = [clean(x) if isinstance(x, dict) else str(x) if isinstance(x, ObjectId) else x for x in v]
        elif isinstance(v, dict): out[k] = clean(v)
        else: out[k] = v
    return out

def serialize_many(cursor):
    return [clean(x) for x in cursor]

def encrypt_secret(value: str) -> str:
    key = os.getenv("CAMERA_ENCRYPTION_KEY", "").strip()
    if not key:
        raise HTTPException(500, "CAMERA_ENCRYPTION_KEY is not configured. Generate a Fernet key and set it in backend/.env.")
    try:
        return Fernet(key.encode()).encrypt(value.encode()).decode()
    except Exception:
        raise HTTPException(500, "Invalid CAMERA_ENCRYPTION_KEY.")

def decrypt_secret(value: str) -> str:
    key = os.getenv("CAMERA_ENCRYPTION_KEY", "").strip()
    if not key:
        raise HTTPException(500, "Encryption key is not configured.")
    try:
        return Fernet(key.encode()).decrypt(value.encode()).decode()
    except (InvalidToken, ValueError):
        raise HTTPException(500, "Stored QR token cannot be decrypted.")


def create_token(user):
    payload = {
        "sub": str(user["_id"]), "role": user["role"],
        "exp": now() + timedelta(minutes=JWT_EXPIRE)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")

def get_current_user(authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Please sign in.")
    try:
        payload = jwt.decode(authorization[7:], JWT_SECRET, algorithms=["HS256"])
        user = db.users.find_one({"_id": ObjectId(payload["sub"])})
    except (JWTError, Exception):
        raise HTTPException(401, "Invalid or expired session.")
    if not user or not user.get("active", True):
        raise HTTPException(401, "Account unavailable.")
    if user["role"] != "admin" and user.get("status") != "approved":
        raise HTTPException(403, "Your account is awaiting admin approval.")
    return user

def allow(*roles):
    def dependency(user=Depends(get_current_user)):
        if user["role"] not in roles:
            raise HTTPException(403, "You do not have permission for this action.")
        return user
    return dependency

class RegisterIn(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)
    role: Literal["student", "teacher"]
    mobile: str = Field(min_length=7, max_length=20)
    enrollment_no: Optional[str] = None
    employee_id: Optional[str] = None
    department: str = Field(min_length=2, max_length=100)
    year: Optional[str] = None
    branch: Optional[str] = None
    document_name: Optional[str] = None

class LoginIn(BaseModel):
    email: EmailStr
    password: str

class UserUpdate(BaseModel):
    name: Optional[str] = None
    mobile: Optional[str] = None
    department: Optional[str] = None
    year: Optional[str] = None
    branch: Optional[str] = None

class SubjectIn(BaseModel):
    name: str
    code: str
    department: str
    teacher_id: Optional[str] = None

class ClassroomIn(BaseModel):
    name: str
    department: str
    capacity: int = 60

class CameraIn(BaseModel):
    name: str
    camera_type: Literal["ip", "rtsp", "usb", "webcam"]
    device_type: Literal["macbook", "android", "laptop", "ip_cctv"] = "macbook"
    stream_url: Optional[str] = None
    username: Optional[str] = ""
    password: Optional[str] = ""
    classroom_id: str

class ScheduleIn(BaseModel):
    subject_id: str
    classroom_id: str
    day: str
    start_time: str
    end_time: str

class AttendanceMark(BaseModel):
    student_id: str
    status: Literal["present", "absent", "late", "excused"]

class ManualAttendanceIn(BaseModel):
    records: list[AttendanceMark] = Field(min_length=1)

class QrScanIn(BaseModel):
    token: str = Field(min_length=20, max_length=256)

class RequestIn(BaseModel):
    attendance_id: str
    reason: str = Field(min_length=5, max_length=1000)

@app.on_event("startup")
def startup():
    client.admin.command("ping")
    db.users.create_index(
    [("email", 1)],
    unique=True,
    sparse=True
)
    db.users.create_index("enrollment_no", unique=True, sparse=True)
    db.users.create_index("employee_id", unique=True, sparse=True)
    db.attendance.create_index([("session_id", ASCENDING), ("student_id", ASCENDING)], unique=True)
    db.face_profiles.create_index("student_id", unique=True)
    db.student_qr_tokens.create_index("student_id", unique=True)

@app.get("/api/health")
def health():
    try:
        client.admin.command("ping")
        return {"status": "ok", "database": "connected", "app": "AttendX"}
    except Exception:
        raise HTTPException(503, "MongoDB is unavailable.")

@app.post("/api/auth/register")
def register(data: RegisterIn):
    email = data.email.lower()
    if db.users.find_one({"email": email}):
        raise HTTPException(409, "An account with this email already exists.")
    if data.role == "student" and not (data.enrollment_no or "").strip():
        raise HTTPException(400, "Enrollment number is required for students.")
    if data.role == "teacher" and not (data.employee_id or "").strip():
        raise HTTPException(400, "Employee ID is required for teachers.")
    user = data.model_dump(exclude_none=True)
    if data.role == "student":
        user.pop("employee_id", None)
        user["enrollment_no"] = data.enrollment_no.strip()
    else:
        user.pop("enrollment_no", None)
        user["employee_id"] = data.employee_id.strip()
    user.pop("password")
    user["email"] = email
    user["password_hash"] = pwd.hash(data.password)
    user["status"] = "pending"
    user["active"] = True
    user["created_at"] = now()
    try:
        result = db.users.insert_one(user)
    except Exception:
        raise HTTPException(409, "Enrollment number or employee ID is already registered.")
    return {"message": "Registration submitted. Admin approval is required.", "user_id": str(result.inserted_id)}

@app.post("/api/auth/login")
def login(data: LoginIn):
    user = db.users.find_one({"email": data.email.lower()})
    if not user or not pwd.verify(data.password, user["password_hash"]):
        raise HTTPException(401, "Incorrect email or password.")
    if not user.get("active", True):
        raise HTTPException(403, "This account is disabled.")
    if user["role"] != "admin" and user.get("status") != "approved":
        raise HTTPException(403, "Your account is awaiting admin approval.")
    return {"access_token": create_token(user), "token_type": "bearer", "user": public_user(user)}

def public_user(user):
    fields = ["_id","name","email","role","status","mobile","enrollment_no","employee_id","department","year","branch"]
    return clean({k:v for k,v in user.items() if k in fields})

@app.get("/api/auth/me")
def me(user=Depends(get_current_user)):
    return public_user(user)

@app.get("/api/profile-qr")
def get_profile_qr(user=Depends(allow("student")), response: Response = None):
    record = db.student_qr_tokens.find_one({"student_id": user["_id"]})

    if record:
        token = decrypt_secret(record["token_encrypted"])
    else:
        token = secrets.token_urlsafe(32)
        db.student_qr_tokens.insert_one({
            "student_id": user["_id"],
            "token_hash": hashlib.sha256(token.encode()).hexdigest(),
            "token_encrypted": encrypt_secret(token),
            "updated_at": now()
        })

    if response is not None:
        response.headers["Cache-Control"] = "no-store"
    return {"token": token}


@app.post("/api/profile-qr/rotate")
def rotate_profile_qr(user=Depends(allow("student")), response: Response = None):
    token = secrets.token_urlsafe(32)
    db.student_qr_tokens.update_one(
        {"student_id": user["_id"]},
        {"$set": {
            "token_hash": hashlib.sha256(token.encode()).hexdigest(),
            "token_encrypted": encrypt_secret(token),
            "updated_at": now()
        }},
        upsert=True
    )
    if response is not None:
        response.headers["Cache-Control"] = "no-store"
    return {"token": token}


@app.get("/api/users")
def users(user=Depends(allow("admin"))):
    return serialize_many(db.users.find({}, {"password_hash": 0}).sort("created_at", -1))

@app.patch("/api/users/{user_id}/approval")
def approve_user(user_id: str, approved: bool, admin=Depends(allow("admin"))):
    result = db.users.update_one({"_id": oid(user_id), "role": {"$in":["student","teacher"]}},
                                 {"$set":{"status":"approved" if approved else "rejected", "reviewed_by":admin["_id"], "reviewed_at":now()}})
    if not result.matched_count: raise HTTPException(404, "User not found.")
    return {"message": "Account status updated."}

@app.patch("/api/users/{user_id}/active")
def active_user(user_id: str, active: bool, admin=Depends(allow("admin"))):
    if user_id == str(admin["_id"]): raise HTTPException(400, "You cannot deactivate your own account.")
    if not db.users.update_one({"_id":oid(user_id)}, {"$set":{"active":active}}).matched_count:
        raise HTTPException(404, "User not found.")
    return {"message":"Account updated."}

@app.patch("/api/profile")
def update_profile(data: UserUpdate, user=Depends(get_current_user)):
    updates = {k:v for k,v in data.model_dump().items() if v is not None}
    if updates: db.users.update_one({"_id":user["_id"]}, {"$set":updates})
    return public_user(db.users.find_one({"_id":user["_id"]}))


@app.post("/api/profile-photo")
async def submit_profile_photo(
    image: UploadFile = File(...),
    consent: bool = Form(...),
    user=Depends(allow("student"))
):
    if not consent:
        raise HTTPException(400, "Please provide consent before submitting your profile photo.")

    allowed_types = {"image/jpeg", "image/png", "image/webp"}
    if image.content_type not in allowed_types:
        raise HTTPException(400, "Please upload a JPEG, PNG, or WEBP image.")

    raw = await image.read(3 * 1024 * 1024 + 1)
    if not raw or len(raw) > 3 * 1024 * 1024:
        raise HTTPException(400, "Image must be smaller than 3 MB.")

    try:
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as check:
                if check.format not in {"JPEG", "PNG", "WEBP"}:
                    raise HTTPException(400, "Unsupported image format.")
                check.verify()

            with Image.open(io.BytesIO(raw)) as source:
                if source.width * source.height > 20_000_000:
                    raise HTTPException(400, "Image dimensions are too large.")
                photo = source.convert("RGB")
                photo.thumbnail((1200, 1200))
                output = io.BytesIO()
                photo.save(output, format="JPEG", quality=85, optimize=True)
                photo_bytes = output.getvalue()

    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError,
            Image.DecompressionBombWarning):
        raise HTTPException(400, "The uploaded image is invalid or too large.")
    finally:
        await image.close()

    timestamp = now()
    db.profile_photos.update_one(
        {"student_id": user["_id"]},
        {"$set": {
            "student_id": user["_id"],
            "photo": photo_bytes,
            "content_type": "image/jpeg",
            "consent": True,
            "status": "submitted",
            "submitted_at": timestamp,
            "updated_at": timestamp
        }},
        upsert=True
    )

    return {
        "status": "submitted",
        "message": "Profile photo submitted successfully.",
        "submitted_at": timestamp
    }


@app.get("/api/profile-photo")
def profile_photo_status(user=Depends(allow("student"))):
    photo = db.profile_photos.find_one(
        {"student_id": user["_id"]},
        {"photo": 0, "_id": 0}
    )
    if not photo:
        return {"status": "not_submitted", "consent": False}

    return {
        "status": photo.get("status", "submitted"),
        "consent": photo.get("consent", False),
        "submitted_at": photo.get("submitted_at"),
        "updated_at": photo.get("updated_at")
    }


@app.get("/api/profile-photo/image")
def get_profile_photo_image(user=Depends(allow("student"))):
    photo = db.profile_photos.find_one({"student_id": user["_id"]})
    if not photo or not photo.get("photo"):
        raise HTTPException(404, "No profile photo has been submitted.")

    return Response(
        content=photo["photo"],
        media_type="image/jpeg",
        headers={"Cache-Control": "no-store"}
    )


@app.delete("/api/profile-photo")
def delete_profile_photo(user=Depends(allow("student"))):
    result = db.profile_photos.delete_one({"student_id": user["_id"]})
    if not result.deleted_count:
        raise HTTPException(404, "No submitted profile photo was found.")

    return {"status": "deleted", "message": "Profile photo deleted."}


@app.post("/api/biometric/enroll")
def biometric_enroll(user=Depends(allow("student"))):
    raise HTTPException(
        status_code=403,
        detail="Biometric enrollment is disabled in this development version."
    )

@app.get("/api/biometric/status")
def biometric_status(user=Depends(allow("student"))):
    profile = db.face_profiles.find_one({"student_id":user["_id"]})
    return clean(profile) if profile else {"status":"not_enrolled","consent":False}

@app.post("/api/subjects")
def create_subject(data: SubjectIn, user=Depends(allow("admin"))):
    doc = data.model_dump()
    if doc.get("teacher_id"):
        teacher = db.users.find_one({"_id": oid(doc["teacher_id"]), "role": "teacher", "status": "approved"})
        if not teacher: raise HTTPException(404, "Approved teacher not found.")
        doc["teacher_id"] = teacher["_id"]
    doc["created_at"] = now()
    res = db.subjects.insert_one(doc)
    return clean(db.subjects.find_one({"_id":res.inserted_id}))

@app.get("/api/subjects")
def subjects(user=Depends(get_current_user)):
    query = {}
    if user["role"] == "teacher": query["teacher_id"] = user["_id"]
    return serialize_many(db.subjects.find(query))

@app.post("/api/classrooms")
def create_classroom(data: ClassroomIn, user=Depends(allow("admin"))):
    res = db.classrooms.insert_one({**data.model_dump(),"created_at":now()})
    return clean(db.classrooms.find_one({"_id":res.inserted_id}))

@app.get("/api/classrooms")
def classrooms(user=Depends(get_current_user)):
    return serialize_many(db.classrooms.find())

@app.post("/api/cameras")
def create_camera(data: CameraIn, user=Depends(allow("admin"))):
    classroom = db.classrooms.find_one({"_id": oid(data.classroom_id)})

    if not classroom:
        raise HTTPException(404, "Classroom not found.")

    if data.camera_type != "webcam" and not data.stream_url:
        raise HTTPException(400, "Stream URL is required for network cameras.")

    doc = {
        "name": data.name,
        "camera_type": data.camera_type,
        "device_type": data.device_type,
        "stream_url": data.stream_url if data.camera_type != "webcam" else None,
        "classroom_id": classroom["_id"],
        "status": "unverified",
        "verified": False,
        "created_at": now(),
        "created_by": user["_id"]
    }

    if data.camera_type != "webcam":
        encrypted = encrypt_secret(
            (data.username or "") + "\n" + (data.password or "")
        )
        doc["credentials_encrypted"] = encrypted

    res = db.cameras.insert_one(doc)

    return {
        "id": str(res.inserted_id),
        "name": data.name,
        "status": "unverified",
        "classroom": classroom["name"],
        "camera_type": data.camera_type,
        "device_type": data.device_type
    }

@app.get("/api/cameras")
def cameras(user=Depends(allow("admin","teacher"))):
    query = {}
    if user["role"] == "teacher":
        subject_ids = [s["_id"] for s in db.subjects.find({"teacher_id":user["_id"]})]
        room_ids = [s["classroom_id"] for s in db.schedules.find({"subject_id":{"$in":subject_ids}})]
        query["classroom_id"] = {"$in":room_ids}

    docs = []
    timestamp = now()

    for c in db.cameras.find(query):
        last_seen = c.get("last_seen")
        status = c.get("status", "unverified")

        if c.get("device_token_hash"):
            if last_seen:
                if last_seen.tzinfo is None:
                    last_seen = last_seen.replace(tzinfo=timezone.utc)

                if (timestamp - last_seen).total_seconds() > 90:
                    status = "offline"
                else:
                    status = "online"
            else:
                status = "offline"

            if status != c.get("status"):
                db.cameras.update_one(
                    {"_id": c["_id"]},
                    {"$set": {"status": status}}
                )

        room = db.classrooms.find_one({"_id":c["classroom_id"]})
        docs.append({
            "id":str(c["_id"]),
            "name":c["name"],
            "camera_type":c["camera_type"],
            "device_type":c.get("device_type", "macbook"),
            "classroom_id":str(c["classroom_id"]),
            "classroom":room["name"] if room else "Unknown",
            "status":status,
            "verified":c.get("verified",False),
            "paired":bool(c.get("device_token_hash")),
            "paired_at":c.get("paired_at").isoformat() if c.get("paired_at") else None,
            "last_seen":c.get("last_seen").isoformat() if c.get("last_seen") else None,
            "last_health_check":c.get("last_health_check")
        })

    return docs

@app.post("/api/cameras/{camera_id}/health-check")
def camera_health(camera_id: str, user=Depends(allow("admin"))):
    cam = db.cameras.find_one({"_id": oid(camera_id)})

    if not cam:
        raise HTTPException(404, "Camera not found.")

    if cam.get("camera_type") == "webcam":
        raise HTTPException(
            400,
            "Built-in webcam must be tested from the browser station."
        )

    ok, detail = False, "Camera stream could not be verified."
    try:
        import cv2
        # If credentials were supplied separately, inject them only into the
        # backend-side RTSP connection URL; never return them to the browser.
        stream_url = cam["stream_url"]
        try:
            key = os.getenv("CAMERA_ENCRYPTION_KEY", "").strip()
            if key:
                raw = Fernet(key.encode()).decrypt(cam["credentials_encrypted"].encode()).decode()
                username, password = raw.split("\\n", 1)
                if username and "://" in stream_url and "@" not in stream_url.split("://",1)[1].split("/",1)[0]:
                    from urllib.parse import urlsplit, urlunsplit, quote
                    parts = urlsplit(stream_url)
                    host = parts.netloc
                    auth = quote(username, safe="") + (":" + quote(password, safe="") if password else "")
                    stream_url = urlunsplit((parts.scheme, auth + "@" + host, parts.path, parts.query, parts.fragment))
        except Exception:
            pass
        cap = cv2.VideoCapture(stream_url)
        ok = bool(cap.isOpened())
        if ok:
            ret, frame = cap.read()
            ok = bool(ret and frame is not None and frame.size > 0)
        cap.release()
        detail = "Stream opened and a fresh frame was received." if ok else "Stream opened unsuccessfully or no fresh frame was received."
    except ImportError:
        detail = "OpenCV is not installed; camera cannot be verified."
    except Exception:
        detail = "Camera health check failed. Verify URL, credentials and network."
    db.cameras.update_one({"_id":cam["_id"]},{"$set":{"status":"online" if ok else "offline","verified":ok,"last_health_check":now(),"health_detail":detail}})
    db.camera_events.insert_one({"camera_id":cam["_id"],"classroom_id":cam["classroom_id"],"event_type":"health_check_passed" if ok else "health_check_failed","detail":detail,"timestamp":now()})
    return {"online":ok,"verified":ok,"detail":detail}

@app.post("/api/schedules")
def create_schedule(data: ScheduleIn, user=Depends(allow("teacher","admin"))):
    valid_days = {
        "Monday", "Tuesday", "Wednesday", "Thursday",
        "Friday", "Saturday", "Sunday"
    }
    if data.day not in valid_days:
        raise HTTPException(400, "Select a valid day.")

    try:
        start = datetime.strptime(data.start_time, "%H:%M")
        end = datetime.strptime(data.end_time, "%H:%M")
    except ValueError:
        raise HTTPException(400, "Time must use HH:MM format.")

    if end <= start:
        raise HTTPException(400, "End time must be later than start time.")

    subject = db.subjects.find_one({"_id": oid(data.subject_id)})
    room = db.classrooms.find_one({"_id": oid(data.classroom_id)})

    if not subject or not room:
        raise HTTPException(404, "Subject or classroom not found.")

    teacher_id = subject.get("teacher_id")

    if user["role"] == "teacher" and teacher_id != user["_id"]:
        raise HTTPException(403, "You can schedule only your assigned subjects.")

    start_minutes = start.hour * 60 + start.minute
    end_minutes = end.hour * 60 + end.minute

    conflict_conditions = [{"classroom_id": room["_id"]}]
    if teacher_id:
        conflict_conditions.append({"teacher_id": teacher_id})

    existing_schedules = db.schedules.find({
        "day": data.day,
        "$or": conflict_conditions
    })

    for existing in existing_schedules:
        try:
            old_start = datetime.strptime(existing["start_time"], "%H:%M")
            old_end = datetime.strptime(existing["end_time"], "%H:%M")
        except (ValueError, KeyError, TypeError):
            raise HTTPException(
                409,
                "An existing schedule has invalid time data. Please review it first."
            )

        old_start_minutes = old_start.hour * 60 + old_start.minute
        old_end_minutes = old_end.hour * 60 + old_end.minute

        overlaps = (
            start_minutes < old_end_minutes
            and end_minutes > old_start_minutes
        )

        if overlaps:
            if existing.get("classroom_id") == room["_id"]:
                raise HTTPException(
                    409,
                    "This classroom already has an overlapping class on this day."
                )
            raise HTTPException(
                409,
                "This teacher already has an overlapping class on this day."
            )

    schedule_doc = {
        **data.model_dump(),
        "subject_id": subject["_id"],
        "classroom_id": room["_id"],
        "teacher_id": teacher_id,
        "department": subject.get("department"),
        "created_at": now()
    }

    res = db.schedules.insert_one(schedule_doc)
    return clean(db.schedules.find_one({"_id": res.inserted_id}))

@app.get("/api/schedules")
def get_schedules(user=Depends(get_current_user)):
    query = {"teacher_id":user["_id"]} if user["role"]=="teacher" else {}
    if user["role"]=="student": query = {"department":user.get("department")}
    return serialize_many(db.schedules.find(query))

@app.post("/api/sessions/{schedule_id}/start")
def start_session(schedule_id: str, user=Depends(allow("teacher","admin"))):
    schedule = db.schedules.find_one({"_id":oid(schedule_id)})
    if not schedule:
        raise HTTPException(404, "Schedule not found.")

    if user["role"] == "teacher" and schedule.get("teacher_id") != user["_id"]:
        raise HTTPException(403, "This class is not assigned to you.")

    # Return an existing active session instead of creating a duplicate.
    active = db.sessions.find_one({
        "schedule_id": schedule["_id"],
        "status": "active"
    })
    if active:
        return {
            "session_id": str(active["_id"]),
            "mode": active.get("mode", "manual_backup"),
            "message": "This class is already active. Reusing the existing session."
        }

    # Use the Indian local date for the unique schedule/date session key.
    class_date = now().astimezone(
        timezone(timedelta(hours=5, minutes=30))
    ).date().isoformat()

    existing_today = db.sessions.find_one({
        "schedule_id": schedule["_id"],
        "class_date": class_date
    })
    if existing_today:
        raise HTTPException(
            409,
            "A session for this schedule has already been created today."
        )

    camera = db.cameras.find_one({
        "classroom_id": schedule["classroom_id"],
        "verified": True,
        "status": "online"
    })
    mode = "camera_pending_integration" if camera else "manual_backup"

    doc = {
        "schedule_id": schedule["_id"],
        "class_date": class_date,
        "teacher_id": schedule.get("teacher_id"),
        "subject_id": schedule["subject_id"],
        "classroom_id": schedule["classroom_id"],
        "camera_id": camera["_id"] if camera else None,
        "mode": mode,
        "status": "active",
        "started_at": now(),
        "ended_at": None
    }

    res = db.sessions.insert_one(doc)
    return {
        "session_id": str(res.inserted_id),
        "mode": mode,
        "message": "Class started in manual attendance mode because no verified camera is available."
        if not camera else
        "Class started. Camera stream is available for viewing; attendance remains teacher-verified."
    }

@app.post("/api/sessions/{session_id}/qr-scan")
def scan_student_qr(
    session_id: str,
    data: QrScanIn,
    user=Depends(allow("teacher", "admin"))
):
    session = db.sessions.find_one({
        "_id": oid(session_id),
        "status": "active"
    })
    if not session:
        raise HTTPException(404, "Active class session not found.")

    if user["role"] == "teacher" and session.get("teacher_id") != user["_id"]:
        raise HTTPException(403, "This session is not assigned to you.")

    token_hash = hashlib.sha256(data.token.encode()).hexdigest()
    qr_record = db.student_qr_tokens.find_one({"token_hash": token_hash})

    if not qr_record:
        raise HTTPException(404, "Invalid or expired student QR code.")

    student = db.users.find_one({
        "_id": qr_record["student_id"],
        "role": "student",
        "status": "approved",
        "active": True
    })

    if not student:
        raise HTTPException(404, "Invalid or expired student QR code.")

    subject = db.subjects.find_one({"_id": session["subject_id"]})
    if not subject:
        raise HTTPException(404, "Session subject not found.")

    if subject.get("department") and student.get("department") != subject["department"]:
        raise HTTPException(403, "This student is not in the session department.")

    existing = db.attendance.find_one({
        "session_id": session["_id"],
        "student_id": student["_id"]
    })
    if existing:
        return {
            "status": "already_marked",
            "message": "Attendance is already saved for this student.",
            "student": {
                "id": str(student["_id"]),
                "name": student.get("name", ""),
                "enrollment_no": student.get("enrollment_no", "")
            }
        }

    return {
        "status": "matched",
        "message": "QR matched. Please verify the student before marking attendance.",
        "student": {
            "id": str(student["_id"]),
            "name": student.get("name", ""),
            "enrollment_no": student.get("enrollment_no", "")
        }
    }


@app.post("/api/sessions/{session_id}/manual-attendance")
def manual_attendance(session_id: str, data: ManualAttendanceIn, user=Depends(allow("teacher","admin"))):
    session = db.sessions.find_one({"_id":oid(session_id),"status":"active"})
    if not session: raise HTTPException(404,"Active class session not found.")
    if user["role"]=="teacher" and session["teacher_id"] != user["_id"]:
        raise HTTPException(403,"This session is not assigned to you.")

    student_ids = [str(oid(record.student_id)) for record in data.records]
    if len(student_ids) != len(set(student_ids)):
        raise HTTPException(400, "Duplicate student IDs are not allowed.")

    inserted, errors = 0, []
    for record in data.records:
        student = db.users.find_one({"_id":oid(record.student_id),"role":"student","status":"approved","active":True})
        if not student: errors.append(record.student_id); continue
        db.attendance.update_one({"session_id":session["_id"],"student_id":student["_id"]},
            {"$set":{"status":record.status,"source":"manual","verification_status":"teacher_approved","marked_by":user["_id"],"updated_at":now()},
             "$setOnInsert":{"created_at":now(),"subject_id":session["subject_id"],"classroom_id":session["classroom_id"]}},upsert=True)
        inserted += 1
    return {"saved":inserted,"skipped":errors}

@app.post("/api/sessions/{session_id}/finalize")
def finalize_session(session_id: str, user=Depends(allow("teacher", "admin"))):
    session = db.sessions.find_one({
        "_id": oid(session_id),
        "status": "active"
    })

    if not session:
        raise HTTPException(404, "Active session not found.")

    if user["role"] == "teacher" and session["teacher_id"] != user["_id"]:
        raise HTTPException(403, "Not your session.")

    records = list(db.attendance.find({"session_id": session["_id"]}))

    summary = {
        "total": len(records),
        "present": sum(1 for r in records if r.get("status") == "present"),
        "absent": sum(1 for r in records if r.get("status") == "absent"),
        "late": sum(1 for r in records if r.get("status") == "late"),
        "excused": sum(1 for r in records if r.get("status") == "excused"),
    }

    result = db.sessions.update_one(
        {"_id": session["_id"], "status": "active"},
        {"$set": {
            "status": "completed",
            "ended_at": now(),
            "finalized_by": user["_id"],
            "attendance_summary": summary
        }}
    )

    if result.modified_count != 1:
        raise HTTPException(409, "Session could not be finalized. Please refresh and try again.")

    return {
        "message": "Attendance session finalized.",
        "summary": summary
    }

@app.get("/api/students")
def students(user=Depends(allow("teacher","admin"))):
    query={"role":"student","status":"approved","active":True}
    if user["role"]=="teacher":
        subs=[s["_id"] for s in db.subjects.find({"teacher_id":user["_id"]})]
        schedules=list(db.schedules.find({"subject_id":{"$in":subs}}))
        depts=list({s.get("department") for s in db.subjects.find({"_id":{"$in":subs}})})
        if depts: query["department"]={"$in":depts}
    return serialize_many(db.users.find(query,{"password_hash":0}).sort("name",1))

@app.get("/api/attendance")
def get_attendance(user=Depends(get_current_user)):
    query={}
    if user["role"]=="student": query["student_id"]=user["_id"]
    if user["role"]=="teacher":
        assigned_sessions = [
            session["_id"]
            for session in db.sessions.find(
                {"teacher_id": user["_id"]},
                {"_id": 1}
            )
        ]
        query["session_id"] = {"$in": assigned_sessions}
    records = list(db.attendance.find(query).sort("created_at",-1).limit(300))

    student_ids = list({
        record["student_id"]
        for record in records
        if record.get("student_id")
    })

    students = {
        str(student["_id"]): student
        for student in db.users.find(
            {"_id": {"$in": student_ids}},
            {"name": 1, "enrollment_no": 1}
        )
    }

    for record in records:
        student = students.get(str(record.get("student_id")), {})
        record["student_name"] = student.get("name", "Unknown student")
        record["enrollment_no"] = student.get("enrollment_no", "—")

    return serialize_many(records)

@app.get("/api/analytics")
def analytics(user=Depends(get_current_user)):
    query={}
    if user["role"]=="student": query["student_id"]=user["_id"]
    records=list(db.attendance.find(query))
    total=len(records); present=sum(1 for r in records if r.get("status") in ("present","late"))
    own=round(present*100/total,1) if total else 0
    all_records=list(db.attendance.find({}))
    avg_present=sum(1 for r in all_records if r.get("status") in ("present","late"))
    avg=round(avg_present*100/len(all_records),1) if all_records else 0
    return {"total":total,"present":present,"absent":sum(1 for r in records if r.get("status")=="absent"),
            "percentage":own,"class_average":avg}

@app.post("/api/attendance-requests")
def create_request(data: RequestIn, user=Depends(allow("student"))):
    att=db.attendance.find_one({"_id":oid(data.attendance_id),"student_id":user["_id"]})
    if not att: raise HTTPException(404,"Attendance record not found.")
    session = db.sessions.find_one({"_id": att["session_id"]})
    assigned_teacher_id = session.get("teacher_id") if session else None

    if not assigned_teacher_id:
        marked_by = db.users.find_one({
            "_id": att.get("marked_by"),
            "role": "teacher",
            "status": "approved",
            "active": True
        })
        assigned_teacher_id = marked_by["_id"] if marked_by else None

    teacher = db.users.find_one({
        "_id": assigned_teacher_id,
        "role": "teacher",
        "status": "approved",
        "active": True
    }) if assigned_teacher_id else None

    if not teacher:
        raise HTTPException(409, "Assigned teacher could not be verified. Please contact the administrator.")

    res=db.attendance_requests.insert_one({"attendance_id":att["_id"],"student_id":user["_id"],"teacher_id":teacher["_id"],
        "reason":data.reason,"status":"pending","created_at":now()})
    return {"id":str(res.inserted_id),"message":"Request submitted."}

@app.get("/api/attendance-requests")
def requests(user=Depends(get_current_user)):
    query={}
    if user["role"]=="student": query["student_id"]=user["_id"]
    elif user["role"]=="teacher": query["teacher_id"]=user["_id"]
    return serialize_many(db.attendance_requests.find(query).sort("created_at",-1))

@app.patch("/api/attendance-requests/{request_id}")
def decide_request(
    request_id: str,
    decision: Literal["accepted", "rejected"],
    corrected_status: Optional[Literal["present", "absent", "late", "excused"]] = None,
    user=Depends(allow("teacher", "admin"))
):
    req = db.attendance_requests.find_one({
        "_id": oid(request_id),
        "status": "pending"
    })

    if not req:
        raise HTTPException(404, "Pending request not found.")

    if user["role"] == "teacher" and req.get("teacher_id") != user["_id"]:
        raise HTTPException(403, "This request is not assigned to you.")

    if decision == "accepted" and not corrected_status:
        raise HTTPException(400, "Select the verified attendance status.")

    if decision == "accepted":
        result = db.attendance.update_one(
            {
                "_id": req["attendance_id"],
                "student_id": req["student_id"]
            },
            {
                "$set": {
                    "status": corrected_status,
                    "verification_status": "teacher_corrected",
                    "updated_at": now(),
                    "corrected_by": user["_id"]
                }
            }
        )

        if result.matched_count != 1:
            raise HTTPException(404, "Attendance record not found.")

    updated = db.attendance_requests.update_one(
        {"_id": req["_id"], "status": "pending"},
        {"$set": {
            "status": decision,
            "reviewed_by": user["_id"],
            "reviewed_at": now()
        }}
    )

    if updated.modified_count != 1:
        raise HTTPException(409, "Request was already reviewed. Refresh and try again.")

    return {"message": f"Request {decision}."}


@app.get("/api/admin/overview")
def admin_overview(user=Depends(allow("admin"))):
    return {"students":db.users.count_documents({"role":"student"}),"teachers":db.users.count_documents({"role":"teacher"}),
            "pending":db.users.count_documents({"status":"pending"}),"cameras":db.cameras.count_documents({}),
            "online_cameras":db.cameras.count_documents({"status":"online"})}


class StationPairIn(BaseModel):
    code: str = Field(min_length=10, max_length=100)


def get_station_camera(authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Device authentication required.")

    token = authorization[7:].strip()
    token_hash = hashlib.sha256(token.encode()).hexdigest()

    camera = db.cameras.find_one({"device_token_hash": token_hash})

    if not camera:
        raise HTTPException(401, "Invalid or revoked device token.")

    return camera


@app.post("/api/cameras/{camera_id}/pairing-code")
def generate_pairing_code(camera_id: str, user=Depends(allow("admin"))):
    camera = db.cameras.find_one({"_id": oid(camera_id)})

    if not camera:
        raise HTTPException(404, "Camera not found.")

    if camera.get("device_type") not in ("macbook", "android", "laptop"):
        raise HTTPException(400, "IP CCTV cameras do not use station pairing.")

    code = secrets.token_urlsafe(18)
    code_hash = hashlib.sha256(code.encode()).hexdigest()
    expiry = now() + timedelta(minutes=10)

    db.cameras.update_one(
        {"_id": camera["_id"]},
        {
            "$set": {
                "pairing_code_hash": code_hash,
                "pairing_expires_at": expiry,
                "pairing_used": False
            },
            "$unset": {
                "device_token_hash": "",
                "paired_at": "",
                "last_seen": ""
            }
        }
    )

    return {
        "camera": camera["name"],
        "pairing_code": code,
        "expires_at": expiry.isoformat(),
        "valid_for_minutes": 10
    }


@app.post("/api/station/pair")
def pair_station(data: StationPairIn):
    code_hash = hashlib.sha256(data.code.strip().encode()).hexdigest()

    camera = db.cameras.find_one({
        "pairing_code_hash": code_hash,
        "pairing_used": False
    })

    if not camera:
        raise HTTPException(401, "Invalid or already-used pairing code.")

    expiry = camera.get("pairing_expires_at")

    if not expiry:
        raise HTTPException(401, "Pairing code expired.")

    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)

    if expiry < now():
        db.cameras.update_one(
            {"_id": camera["_id"]},
            {"$unset": {"pairing_code_hash": "", "pairing_expires_at": ""}}
        )
        raise HTTPException(401, "Pairing code expired. Generate a new code.")

    device_token = secrets.token_urlsafe(32)
    device_token_hash = hashlib.sha256(device_token.encode()).hexdigest()

    result = db.cameras.update_one(
        {
            "_id": camera["_id"],
            "pairing_code_hash": code_hash,
            "pairing_expires_at": camera["pairing_expires_at"],
            "pairing_used": False
        },
        {
            "$set": {
                "device_token_hash": device_token_hash,
                "paired_at": now(),
                "pairing_used": True,
                "status": "paired"
            },
            "$unset": {
                "pairing_code_hash": "",
                "pairing_expires_at": ""
            }
        }
    )

    if result.modified_count != 1:
        raise HTTPException(409, "Pairing code has already been used.")

    return {
        "message": "Device paired successfully.",
        "device_token": device_token,
        "camera_id": str(camera["_id"]),
        "camera": camera["name"],
        "device_type": camera.get("device_type"),
        "classroom_id": str(camera["classroom_id"])
    }


@app.post("/api/station/heartbeat")
def station_heartbeat(camera=Depends(get_station_camera)):
    timestamp = now()

    db.cameras.update_one(
        {"_id": camera["_id"]},
        {
            "$set": {
                "last_seen": timestamp,
                "status": "online"
            }
        }
    )

    return {
        "ok": True,
        "status": "online",
        "camera_id": str(camera["_id"]),
        "last_seen": timestamp.isoformat()
    }


@app.post("/api/station/stream-started/{camera_id}")
def station_stream_started(camera_id: str, camera=Depends(get_station_camera)):
    requested_id = oid(camera_id)

    if requested_id != camera["_id"]:
        raise HTTPException(403, "This device is not paired with that camera.")

    timestamp = now()

    db.cameras.update_one(
        {"_id": camera["_id"]},
        {"$set": {
            "verified": True,
            "status": "online",
            "last_seen": timestamp,
            "stream_verified_at": timestamp
        }}
    )

    return {
        "ok": True,
        "verified": True,
        "status": "online",
        "camera_id": str(camera["_id"])
    }


@app.post("/api/cameras/{camera_id}/revoke-device")
def revoke_camera_device(camera_id: str, user=Depends(allow("admin"))):
    camera = db.cameras.find_one({"_id": oid(camera_id)})

    if not camera:
        raise HTTPException(404, "Camera not found.")

    db.cameras.update_one(
        {"_id": camera["_id"]},
        {
            "$set": {
                "status": "unverified",
                "verified": False
            },
            "$unset": {
                "device_token_hash": "",
                "paired_at": "",
                "last_seen": "",
                "pairing_code_hash": "",
                "pairing_expires_at": "",
                "pairing_used": ""
            }
        }
    )

    return {"message": "Device pairing revoked successfully."}


class MediaMTXAuthIn(BaseModel):
    user: Optional[str] = None
    password: Optional[str] = None
    token: Optional[str] = None
    action: str
    path: str
    protocol: Optional[str] = None


@app.post("/api/mediamtx/auth")
def mediamtx_auth(data: MediaMTXAuthIn):
    credential = data.password or data.token or ""

    if not credential:
        raise HTTPException(401, "Authentication required.")

    if data.action not in ("publish", "read"):
        raise HTTPException(403, "Streaming action not permitted.")

    if not data.path.startswith("camera-"):
        raise HTTPException(403, "Invalid camera stream path.")

    camera_id = data.path.removeprefix("camera-")

    try:
        camera = db.cameras.find_one({"_id": ObjectId(camera_id)})
    except Exception:
        camera = None

    if not camera:
        raise HTTPException(403, "Camera not found.")

    if data.action == "publish":
        if camera.get("device_type") not in ("macbook", "android", "laptop"):
            raise HTTPException(403, "This camera cannot publish a station stream.")

        token_hash = hashlib.sha256(credential.encode()).hexdigest()

        stored_hash = camera.get("device_token_hash") or ""

        if not secrets.compare_digest(token_hash, stored_hash):
            raise HTTPException(401, "Invalid station credentials.")

        return {"authorized": True}

    try:
        payload = jwt.decode(
            credential,
            JWT_SECRET,
            algorithms=["HS256"]
        )
        user = db.users.find_one({"_id": ObjectId(payload["sub"])})
    except Exception:
        raise HTTPException(401, "Invalid admin session.")

    if not user or not user.get("active", True):
        raise HTTPException(403, "Active account required.")

    if user.get("role") == "admin":
        return {"authorized": True}

    if user.get("role") != "teacher":
        raise HTTPException(403, "Teacher or admin access required.")

    subject_ids = [
        subject["_id"]
        for subject in db.subjects.find({"teacher_id": user["_id"]})
    ]

    room_ids = [
        schedule["classroom_id"]
        for schedule in db.schedules.find({
            "subject_id": {"$in": subject_ids}
        })
    ]

    if camera.get("classroom_id") not in room_ids:
        raise HTTPException(403, "This camera is outside your assigned classrooms.")

    return {"authorized": True}
