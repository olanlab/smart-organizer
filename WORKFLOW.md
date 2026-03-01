# คู่มือขั้นตอนการพัฒนา (Development Workflow) - ฉบับปรับปรุง

สรุปขั้นตอนการทำงานระดับมืออาชีพสำหรับโปรเจกต์ `@olanlab/smart-organizer` ที่ใช้ระบบอัตโนมัติ 100% และรองรับการทำ Pull Request (PR)

---

## 1. การเริ่มงานใหม่ (Feature Branching)
ห้ามพัฒนาโค้ดบนกิ่ง `main` โดยตรง ให้สร้างกิ่งใหม่ (Feature Branch) ทุกครั้ง:
```bash
git checkout -b <ชื่อกิ่ง>
# ตัวอย่าง: git checkout -b feat/add-rar-support
```

## 2. การ Commit งาน (Local Validation)
คุณต้องเขียน Commit Message ตามรูปแบบ **Conventional Commits**:
*   **คำสั่ง:** `git commit -m "<type>: <subject>"`
*   **ด่านตรวจ (Husky):** 
    *   **commit-msg:** เช็คว่าพิมพ์ถูกรูปแบบไหม โดยต้องขึ้นต้นด้วย `<type>:` ตามด้วยข้อความ (เช่น `feat: add PDF support`)
        *   `feat:` เพิ่มฟีเจอร์ใหม่ (จะอัปเดตเลข Minor: 1.0.0 -> 1.1.0)
        *   `fix:` แก้ไขบั๊ก (จะอัปเดตเลข Patch: 1.0.0 -> 1.0.1)
        *   `chore:`, `docs:`, `style:`, `refactor:`, `perf:`, `test:` งานทั่วไป (จะ**ไม่ออก**เวอร์ชันใหม่)
    *   **pre-commit:** รัน `lint-staged` เพื่อแก้โค้ด JS ให้สวยงามอัตโนมัติก่อน commit

## 3. การส่งงานและสร้าง Pull Request (PR) ผ่าน CLI
เมื่อแก้โค้ดเสร็จแล้ว ให้ใช้ GitHub CLI (`gh`) เพื่อความรวดเร็ว:
```bash
# 1. ส่งกิ่งขึ้น GitHub
git push origin HEAD

# 2. สร้าง PR
gh pr create --title "<หัวข้อ>" --body "<รายละเอียด>"

# 3. สั่ง Merge อัตโนมัติ (จะรอจนกว่า Test จะผ่านแล้ว Merge เอง)
gh pr merge --auto --squash --delete-branch
```

## 4. ระบบอัตโนมัติบน GitHub (CI/CD Pipeline)
เมื่อ PR ถูก Merge เข้า `main` ระบบจะทำงานต่อให้เอง:
1.  **Test & Lint:** ตรวจสอบความถูกต้องของโค้ด (Job: `test (22.x)`)
2.  **Semantic Release:** (รันผ่าน `RELEASE_GITHUB_TOKEN` เพื่อข้ามกฎป้องกันกิ่ง)
    *   คำนวณเลขเวอร์ชันใหม่จาก Commit Message
    *   สร้างไฟล์ `CHANGELOG.md` และ Git Tag (เช่น `v1.2.1`)
    *   Publish แพ็กเกจขึ้น **NPM (@olanlab/smart-organizer)**

## 5. การซิงค์ข้อมูลกลับมายังเครื่อง (Fully Sync)
เพื่อให้เลขเวอร์ชันในเครื่องตรงกับ GitHub คุณสามารถใช้คำสั่ง "เฝ้าระบบ" ได้:
```bash
# รันคำสั่งนี้ทิ้งไว้หลังจากสั่ง gh pr merge
gh run watch && git pull origin main
```
*แนะนำ: ตั้ง Alias `alias gsync='gh run watch && git pull origin main'` ไว้ใช้จะสะดวกมากครับ*

---

### ระบบความปลอดภัยที่ตั้งค่าไว้:
*   **Branch Protection**: กิ่ง `main` ถูกป้องกันไว้ ห้าม Push ตรงๆ ต้องผ่าน PR เท่านั้น
*   **Bypass List**: ระบบอนุญาตให้ Bot (ผ่าน Admin PAT) เท่านั้นที่สามารถอัปเดตเลขเวอร์ชันกลับเข้า `main` ได้โดยตรง

---

### สรุปคำสั่งที่ใช้บ่อย:
*   `git checkout -b <branch>` : เริ่มงานใหม่
*   `git commit -m "feat: ..."` : บันทึกงาน (Minor bump)
*   `git commit -m "fix: ..."` : บันทึกงาน (Patch bump)
*   `gh pr merge --auto --squash --delete-branch` : สั่ง Merge ล่วงหน้า
*   `git pull origin main` : ดึงเวอร์ชันล่าสุด
