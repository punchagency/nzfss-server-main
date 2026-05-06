# Yearbook Upload Limits

Yearbook uploads now use a 20 MB limit by default on both frontend and backend.

## Configuration

- Backend env: `YEARBOOK_UPLOAD_MAX_SIZE_MB`
  - Default: `20`
  - Used by: `src/config/upload.ts`
- Frontend env: `NEXT_PUBLIC_YEARBOOK_MAX_SIZE_MB`
  - Default: `20`
  - Used by: `constants/upload.ts`

## Notes

- Frontend validates selected file size before base64 conversion.
- Backend validates decoded file size before uploading to S3.
- Keep both env values aligned to avoid inconsistent behavior.
