# บันทึกการสรุปปัญหาและแนวทางการแก้ไข (Smart Organizer CLI)

สรุปเหตุการณ์และบทเรียนที่ได้รับจากการพัฒนาและตั้งค่าระบบ CI/CD ของโปรเจกต์ `org` (@olanlab/smart-organizer)

---

## 1. การเปลี่ยนชื่อคำสั่ง (Command Renaming)
*   **ปัญหา:** ต้องการเปลี่ยนคำสั่งจาก `smart-organizer` ให้สั้นลงเป็น `org`
*   **วิธีแก้:** 
    *   แก้ไขส่วน `"bin"` ใน `package.json`
    *   เพิ่ม `program.name('org')` ใน `bin/index.js`
    *   รัน `npm link` (หรือ `sudo npm link`) เพื่อลงทะเบียนคำสั่งใหม่ในเครื่อง

## 2. ปัญหา Permissions (EACCES)
*   **ปัญหา:** รัน `npm link` หรือ `npm install` แล้วติด Error `EACCES` (Permission Denied)
*   **สาเหตุ:** โฟลเดอร์ระบบของ npm หรือโฟลเดอร์ Cache (`~/.npm`) ถูกจำกัดสิทธิ์ (อาจเคยรัน `sudo` มาก่อนหน้า)
*   **วิธีแก้:** 
    *   ใช้ `sudo chown -R $(whoami) ~/.npm` เพื่อคืนสิทธิ์ให้กับ User ปัจจุบัน
    *   หรือใช้ `sudo npm link` สำหรับการติดตั้ง Global

## 3. ระบบตรวจสอบโค้ด (ESLint Flat Config)
*   **ปัญหา:** ESLint v9/v10 ไม่รองรับไฟล์ `.eslintrc.json` แบบเดิม
*   **วิธีแก้:** เปลี่ยนมาใช้โครงสร้างใหม่ในไฟล์ `eslint.config.js` และใช้แพ็กเกจ `globals` เพื่อระบุสภาพแวดล้อม (Node, Jest)

## 4. GitHub Actions หาไฟล์ไม่เจอ (Path & Cache)
*   **ปัญหา:** Workflow แจ้งว่าหา `package-lock.json` ไม่เจอ ทำให้ทำ Caching ไม่สำเร็จ
*   **สาเหตุ:** 
    1.  ระบุ Path ผิด (โปรเจกต์ซ้อนอยู่ในโฟลเดอร์ย่อยบน GitHub)
    2.  ไฟล์ `package-lock.json` ถูกระบุไว้ใน `.gitignore` ทำให้ไฟล์ไม่ถูกอัปโหลดขึ้น GitHub
*   **วิธีแก้:** 
    *   นำ `package-lock.json` ออกจาก `.gitignore`
    *   ตรวจสอบโครงสร้างไฟล์บน GitHub ให้แน่ใจว่าตรงกับใน YAML (ปัจจุบันใช้ระดับ Root)

## 5. การ Publish ไปยัง NPM (403 Forbidden)
*   **ปัญหา:** รัน `npm publish` แล้วติด Error 403
*   **สาเหตุ:** 
    1.  ชื่อ `smart-organizer` มีคนใช้ไปแล้วบน NPM
    2.  NPM Token ไม่มีสิทธิ์เขียน หรือติดระบบ 2FA (Two-Factor Authentication)
*   **วิธีแก้:** 
    *   เปลี่ยนชื่อแพ็กเกจเป็นแบบ Scoped Name (เช่น `@olanlab/smart-organizer`)
    *   สร้าง NPM Token ประเภท **Automation** (Classic) เพื่อข้ามการถามรหัส 2FA ใน CI/CD
    *   เพิ่ม `--access public` ในคำสั่ง publish สำหรับ Scoped Package

## 6. ระบบ Semantic Release (Automation 100%)
*   **ปัญหา:** `GITHUB_TOKEN` ไม่มีสิทธิ์ Push Tag กลับมาที่ Repository (Error 403)
*   **วิธีแก้:** เพิ่ม `permissions: contents: write` ในไฟล์ `pipeline.yml` เพื่อให้ Bot มีสิทธิ์เขียนข้อมูลกลับเข้า Git
*   **บทเรียน:** การใช้ Semantic Release ต้องเขียน Commit Message ตามรูปแบบ (Conventional Commits) เช่น `fix:` หรือ `feat:` เพื่อให้ระบบรู้ว่าต้องอัปเดตเวอร์ชันหรือไม่

## 7. ปัญหา Git Push Rejected (Non-fast-forward)
*   **ปัญหา:** Push โค้ดไม่ขึ้นเพราะ "behind its remote counterpart"
*   **สาเหตุ:** Bot บน GitHub ทำการแก้ไขไฟล์ (`CHANGELOG.md`, `package.json`) และสร้าง Tag ใหม่ ทำให้โค้ดบน GitHub ล้ำหน้ากว่าในเครื่องเรา
*   **วิธีแก้:** ต้องรัน `git pull origin main --rebase` เพื่อดึงการเปลี่ยนแปลงจาก Bot ลงมาที่เครื่องก่อน แล้วค่อย Push ใหม่

---
**คำแนะนำเพิ่มเติม:** 
หมั่นรัน `git pull` ทุกครั้งก่อนเริ่มทำงาน เพื่อให้เลขเวอร์ชันในเครื่องตรงกับที่ Bot อัปเดตให้บน GitHub ครับ!
