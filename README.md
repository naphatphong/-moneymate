# ระบบล็อคอิน (Express + PostgreSQL) — MoneyMate

โปรเจกต์นี้เป็นระบบล็อคอิน/สมัครสมาชิกพร้อมแบ็คเอนด์ เชื่อมกับฐานข้อมูล PostgreSQL จริง (ข้อมูลไม่หายเวลาเซิร์ฟเวอร์รีสตาร์ท) พร้อม deploy ขึ้นอินเทอร์เน็ตให้คนอื่นเข้าใช้งานได้จากที่ไหนก็ได้

## โครงสร้างไฟล์

```
login-system/
├── server.js          # เซิร์ฟเวอร์หลัก (routes ทั้งหมด)
├── database.js         # เชื่อมต่อ PostgreSQL และคำสั่ง query ทั้งหมด
├── package.json
├── .env.example        # ตัวอย่างไฟล์ตั้งค่า (คัดลอกเป็น .env)
└── public/
    ├── index.html      # หน้าแรก/แนะนำแอป MoneyMate (ปุ่มไปสมัคร/เข้าสู่ระบบ)
    ├── login.html
    ├── register.html
    ├── app.html        # ตัวแอป MoneyMate จริง เข้าได้เฉพาะคนที่ล็อคอินแล้ว
    ├── css/style.css
    └── js/auth.js
```

## ส่วนที่ 1: รันบนเครื่องตัวเอง (สำหรับทดสอบ)

### 1.1 สร้างฐานข้อมูล PostgreSQL ฟรี (Neon)

1. ไปที่ https://neon.tech แล้วสมัครสมาชิก (ใช้ GitHub/Google ล็อคอินได้เลย ไม่ต้องผูกบัตร)
2. กด "Create a project" ตั้งชื่ออะไรก็ได้ เช่น `moneymate`
3. หลังสร้างเสร็จ จะมีหน้า "Connection string" ให้คัดลอกค่าที่ขึ้นต้นด้วย `postgresql://...` เก็บไว้ (จะใช้เป็น `DATABASE_URL`)

### 1.2 ตั้งค่าโปรเจกต์

1. แตกไฟล์ zip ที่ได้รับ
2. คัดลอกไฟล์ `.env.example` แล้วเปลี่ยนชื่อเป็น `.env`
3. เปิดไฟล์ `.env` แล้ววาง connection string จาก Neon ลงในช่อง `DATABASE_URL` และตั้ง `SESSION_SECRET` เป็นข้อความสุ่ม ๆ ยาว ๆ (จะใช้ตัวช่วยสุ่มอะไรก็ได้ หรือพิมพ์เองยาว ๆ ก็ได้)

### 1.3 รัน

```
npm install
npm start
```

เปิดเบราว์เซอร์ไปที่ `http://localhost:3000` ระบบจะสร้างตาราง `users` ในฐานข้อมูล Neon ให้อัตโนมัติตอนรันครั้งแรก

## ส่วนที่ 2: Deploy ขึ้นอินเทอร์เน็ตให้คนอื่นเข้าได้ (Render.com)

### 2.1 อัปโหลดโปรเจกต์ขึ้น GitHub

1. สมัคร/ล็อคอิน GitHub (https://github.com)
2. สร้าง repository ใหม่ (New repository) ตั้งชื่อ เช่น `moneymate-login`, เลือก Private หรือ Public ก็ได้
3. ในโฟลเดอร์โปรเจกต์บนเครื่อง เปิด terminal แล้วรัน:
   ```
   git init
   git add .
   git commit -m "initial commit"
   git branch -M main
   git remote add origin https://github.com/<username>/moneymate-login.git
   git push -u origin main
   ```
   (แทน `<username>` ด้วยชื่อ GitHub ของคุณ — ถ้ายังไม่มี git ในเครื่อง ดาวน์โหลดได้ที่ https://git-scm.com)

### 2.2 สร้าง Web Service บน Render

1. ไปที่ https://render.com สมัครสมาชิกด้วย GitHub
2. กด "New +" → "Web Service"
3. เลือก repository `moneymate-login` ที่เพิ่ง push ไป
4. ตั้งค่า:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
5. เลื่อนลงมาที่ "Environment Variables" แล้วเพิ่ม:
   - `DATABASE_URL` = connection string จาก Neon (อันเดียวกับที่ใส่ใน `.env`)
   - `SESSION_SECRET` = ข้อความลับสุ่ม ๆ (ตั้งใหม่ก็ได้ ไม่ต้องซ้ำกับตอนทดสอบ)
   - `NODE_ENV` = `production`
6. กด "Create Web Service" รอสักครู่ (ครั้งแรกใช้เวลาประมาณ 2-5 นาที)
7. เมื่อขึ้นสถานะ "Live" จะได้ URL สาธารณะ เช่น `https://moneymate-login.onrender.com` — ส่ง URL นี้ให้ใครก็เข้าใช้งานได้ทันที

### ข้อควรรู้เกี่ยวกับแพลนฟรีของ Render

- เซิร์ฟเวอร์ฟรีจะ "หลับ" เมื่อไม่มีคนเข้าใช้งานสักพัก แล้วตื่นใหม่เมื่อมีคนเปิด (รอบแรกอาจช้าประมาณ 30-60 วินาที) — แต่ **ข้อมูลผู้ใช้ในฐานข้อมูล Neon จะไม่หาย** เพราะฐานข้อมูลแยกอยู่คนละที่กับตัวเซิร์ฟเวอร์
- ถ้าอยากให้เซิร์ฟเวอร์ไม่หลับเลย ต้องอัปเกรดเป็นแพลนเสียเงินของ Render

## API ที่มีให้ใช้

| Method | Endpoint | คำอธิบาย |
|---|---|---|
| POST | `/api/register` | สมัครสมาชิก (body: username, email, password) |
| POST | `/api/login` | เข้าสู่ระบบ (body: username, password) |
| POST | `/api/logout` | ออกจากระบบ |
| GET  | `/api/me` | ดึงข้อมูลผู้ใช้ที่ล็อคอินอยู่ (ต้องล็อคอินก่อน) |
| GET  | `/api/protected-example` | ตัวอย่าง endpoint ที่ต้องล็อคอินก่อนถึงเรียกได้ |

## วิธีเอาไปรวมกับเว็บอื่นที่ทำจาก Vibe Code

1. ก็อปปี้ไฟล์ HTML/CSS/JS เดิมเข้ามาไว้ในโฟลเดอร์ `public/` ของโปรเจกต์นี้
2. ในหน้าใดก็ตามที่อยากให้ "ต้องล็อคอินก่อนถึงจะเข้าได้" ให้เพิ่มสคริปต์เช็คสถานะแบบเดียวกับใน `app.html`:
   ```html
   <script>
     fetch('/api/me').then(res => {
       if (!res.ok) window.location.href = '/login.html';
     });
   </script>
   ```
3. ถ้ามีปุ่มหรือส่วนที่อยากโชว์ชื่อผู้ใช้ ก็เรียก `/api/me` แล้วเอาค่า `data.user.username` ไปแสดงได้เลย

## หมายเหตุด้านความปลอดภัย

- รหัสผ่านถูกเข้ารหัสด้วย bcrypt ก่อนเก็บลงฐานข้อมูลเสมอ (ไม่เก็บ plain text)
- อย่า commit ไฟล์ `.env` ขึ้น GitHub เด็ดขาด (มี `.gitignore` กันไว้ให้แล้ว) เพราะมี `DATABASE_URL` และ `SESSION_SECRET` ซึ่งเป็นข้อมูลลับ
- เมื่อ `NODE_ENV=production` ระบบจะเปิด secure cookie ให้อัตโนมัติ (ทำงานได้เพราะ Render ให้ HTTPS มาให้อยู่แล้ว)
"# -moneymate" 
"# -moneymate1" 
