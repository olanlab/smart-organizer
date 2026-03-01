# คู่มือขั้นตอนการพัฒนา (Development Workflow)

สรุปขั้นตอนการทำงานระดับมืออาชีพสำหรับโปรเจกต์ `@olanlab/smart-organizer` ที่ใช้ระบบอัตโนมัติ 100%

---

## 1. การเริ่มงานใหม่ (Feature Branching)
ห้ามพัฒนาโค้ดบนกิ่ง `main` โดยตรง ให้สร้างกิ่งใหม่ (Feature Branch) ทุกครั้ง:
```bash
git checkout -b <ชื่อกิ่ง>
# ตัวอย่าง: git checkout -b feat/add-zip-support
```

## 2. การ Commit งาน (Local Validation)
คุณต้องเขียน Commit Message ตามรูปแบบ **Conventional Commits** เพื่อให้ระบบออกเวอร์ชันได้ถูกต้อง:
*   **คำสั่ง:** `git commit -m "<type>: <subject>"`
*   **รูปแบบที่ยอมรับ:**
    *   `feat:` เพิ่มฟีเจอร์ใหม่ (จะอัปเดตเลข Minor: 1.0.0 -> 1.1.0)
    *   `fix:` แก้ไขบั๊ก (จะอัปเดตเลข Patch: 1.0.0 -> 1.0.1)
    *   `chore:`, `docs:`, `test:`, `refactor:` งานทั่วไป (จะ**ไม่ออก**เวอร์ชันใหม่)
*   **ด่านตรวจ (Husky):** หากเขียนผิดรูปแบบ ระบบจะบล็อกการ commit และแจ้งเตือนทันที

## 3. การส่งงานและสร้าง Pull Request (PR)
เมื่อแก้โค้ดเสร็จแล้ว ให้ส่งขึ้น GitHub และสร้าง PR ผ่าน CLI:
```bash
# 1. ส่งกิ่งขึ้น GitHub
git push origin HEAD

# 2. สร้าง PR (ใช้ GitHub CLI)
gh pr create --title "<หัวข้อ>" --body "<รายละเอียด>"

# 3. ตั้งค่า Merge อัตโนมัติ (จะรอจนกว่า Test จะผ่านแล้ว Merge เอง)
gh pr merge --auto --squash --delete-branch
```

## 4. ระบบอัตโนมัติบน GitHub (CI/CD Pipeline)
หลังจากที่คุณสั่ง Merge ระบบจะทำงานต่อให้เอง 100%:
1.  **Test & Lint:** ตรวจสอบความถูกต้องและความสวยงามของโค้ด
2.  **Semantic Release:** (เมื่อ Merge เข้า `main` สำเร็จ)
    *   คำนวณเลขเวอร์ชันใหม่จาก Commit Message
    *   สร้างไฟล์ `CHANGELOG.md` สรุปรายการเปลี่ยนแปลง
    *   สร้าง **GitHub Release** และ **Git Tag** (เช่น `v1.1.0`)
    *   Publish แพ็กเกจขึ้น **NPM (@olanlab/smart-organizer)**

## 5. การซิงค์ข้อมูลกลับมายังเครื่อง (Sync Back)
หลังจากที่ Bot ทำงานเสร็จสิ้น ให้ดึงข้อมูลล่าสุดกลับมาที่เครื่องเพื่ออัปเดตเลขเวอร์ชันและ Changelog:
```bash
git pull origin main
```

---

### สรุปคำสั่งที่ใช้บ่อย:
*   `git checkout -b <branch>` : เริ่มงานใหม่
*   `git commit -m "feat: ..."` : บันทึกงาน (Minor bump)
*   `git commit -m "fix: ..."` : บันทึกงาน (Patch bump)
*   `gh pr create` : สร้าง PR
*   `gh pr merge --auto --squash --delete-branch` : สั่ง Merge ล่วงหน้า (แนะนำ!)
*   `git pull origin main` : ดึงเวอร์ชันล่าสุดกลับมา

**หมายเหตุ:** อย่าลืมตรวจสอบว่าคุณได้ Login GitHub CLI แล้วด้วยคำสั่ง `gh auth login` ครับ
