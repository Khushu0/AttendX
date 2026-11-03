import getpass
from datetime import datetime, timezone
from dotenv import load_dotenv
from pymongo import MongoClient
from passlib.context import CryptContext
from email_validator import validate_email, EmailNotValidError
import os

load_dotenv()
client=MongoClient(os.getenv("MONGODB_URI","mongodb://127.0.0.1:27017"))
db=client[os.getenv("MONGODB_DB","AttendX")]
pwd=CryptContext(schemes=["bcrypt"],deprecated="auto")

name=input("Admin full name: ").strip()
email=input("Admin email: ").strip().lower()
password=getpass.getpass("Admin password (8+ characters): ")
if len(password)<8: raise SystemExit("Password must be at least 8 characters.")
try: validate_email(email)
except EmailNotValidError: raise SystemExit("Enter a valid email.")
if db.users.find_one({"email":email}): raise SystemExit("This email already exists.")
db.users.insert_one({"name":name,"email":email,"password_hash":pwd.hash(password),"role":"admin",
                     "status":"approved","active":True,"created_at":datetime.now(timezone.utc)})
print("Admin account created. You can now sign in.")
