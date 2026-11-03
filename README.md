# AttendX — Smart Attendance & Classroom Analytics

A runnable development starter for the finalized AttendX workflow:
- Student, Teacher and Admin roles
- Signup/login with hashed passwords and JWT
- Admin approval for student/teacher accounts
- Student profile and biometric-enrollment status workflow
- Teacher subjects, schedules and class sessions
- Admin camera registration, classroom assignment and health-check workflow
- Teacher-triggered class start
- Manual attendance as the only camera-failure backup
- Attendance correction requests
- Student attendance summaries and class averages
- MongoDB persistence

## Important scope and camera note

This project is a working application starter, not a certified biometric attendance product. It includes camera registration, secure credential storage, health-check status and session gating. The recognition pipeline is deliberately an integration boundary: a real classroom camera needs a compatible stream, tested face-recognition engine, suitable camera placement, consent/legal review, and on-site validation. The current build does **not** pretend that a successful camera connection means a student has been identified. Until a validated recognition adapter is installed, teachers should use the included manual attendance workflow.

Biometric enrollment in this starter stores an enrollment status and consent record, not a face template. Do not upload real biometric information to a demo deployment.

## Requirements
- Node.js 20+
- Python 3.11+
- MongoDB Community Server running locally, or a MongoDB Atlas URI
- VS Code
- Optional: a supported IP camera stream for camera connectivity checks

MongoDB Compass is a GUI to inspect your database. The app connects directly to MongoDB; Compass does not act as the database server.

## 1. Configure MongoDB
Start MongoDB locally and open MongoDB Compass. Connect to:

`mongodb://127.0.0.1:27017`

The backend creates the `attendx` database and collections automatically when records are inserted.

## 2. Backend setup

Open a terminal in VS Code:

```bash
cd AttendX/backend
python3 -m venv .venv
```

macOS/Linux:
```bash
source .venv/bin/activate
```

Windows:
```powershell
.venv\Scripts\Activate.ps1
```

Install dependencies:
```bash
pip install -r requirements.txt
```

Copy `.env.example` to `.env`, then set a long random `JWT_SECRET` and your MongoDB URI. Generate the camera encryption key with:

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Paste the generated value into `CAMERA_ENCRYPTION_KEY` in `.env`. Keep `.env` private and never commit it.

Start the backend:
```bash
uvicorn app.main:app --reload --port 8000
```

API documentation: http://127.0.0.1:8000/docs

## 3. Create the first admin

In a second terminal, from `AttendX/backend` with the virtual environment active:

```bash
python -m app.create_admin
```

Follow the prompts. Admin signup is intentionally disabled in the public registration form.

## 4. Frontend setup

In another terminal:

```bash
cd AttendX/frontend
npm install
npm run dev
```

Open the local URL printed by Vite, usually http://localhost:5173.

The frontend uses `/api` and Vite proxies it to FastAPI at port 8000.

## 5. First-use workflow
1. Sign in with the admin account you created.
2. Add departments/subjects/classrooms as needed.
3. Register a camera and assign it to a classroom.
4. Run a camera health check. A successful check means the stream is reachable; it does not verify face-recognition accuracy.
5. Register a student and a teacher from the public signup page.
6. Approve both accounts from Admin → Users.
7. Teacher creates a schedule and starts a class.
8. If the camera is not verified/online, the session is marked as manual-backup mode.
9. Teacher records attendance manually and finalizes it.
10. Student can view attendance and submit a correction request.

## Camera connection
For security, camera credentials are sent only to the backend and encrypted at rest using `CAMERA_ENCRYPTION_KEY`. Configure that key in `.env`. A camera stream URL must be a valid stream endpoint supported by the camera (for example RTSP); a camera's browser login page is not necessarily a video stream. Some cameras require VPN, firewall or ONVIF configuration.

The included health check attempts a short OpenCV stream read when OpenCV is installed. If it is unavailable or the stream cannot be opened, the camera is not marked verified. Never expose camera URLs/passwords to frontend code.

## Security and production checklist
Before using real students:
- Obtain informed consent and provide a non-biometric alternative.
- Review applicable privacy, education and biometric-data laws with the institution.
- Use HTTPS, secure cookie/token storage, rate limiting and production secrets.
- Restrict camera network access and use a dedicated least-privilege camera account.
- Deploy a validated recognition engine and test false matches / missed matches in the actual classroom.
- Keep AI results provisional until teacher review.
- Configure retention, deletion, backup and incident-response policies.
- Do not treat a camera's failure to recognize a face as proof of absence.

## Troubleshooting
- `MongoDB connection failed`: make sure MongoDB is running and `MONGODB_URI` is correct.
- `401`: sign in again; token may have expired.
- `403 Account pending`: approve the account using Admin → Users.
- Camera health check fails: confirm the stream URL, credentials, network reachability and camera stream protocol.
- Frontend cannot reach API: start Fastend on port 8000 and Vite on 5173.

This is a development foundation. Review the code and security settings before any institutional deployment.
