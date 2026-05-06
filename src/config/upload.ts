const DEFAULT_YEARBOOK_MAX_FILE_SIZE_MB = 20;

function parseYearbookMaxFileSizeMb(): number {
  const configuredMb = Number(process.env.YEARBOOK_UPLOAD_MAX_SIZE_MB);

  if (!Number.isFinite(configuredMb) || configuredMb <= 0)
    return DEFAULT_YEARBOOK_MAX_FILE_SIZE_MB;

  return configuredMb;
}

export const YEARBOOK_MAX_FILE_SIZE_MB = parseYearbookMaxFileSizeMb();
export const YEARBOOK_MAX_FILE_SIZE_BYTES =
  YEARBOOK_MAX_FILE_SIZE_MB * 1024 * 1024;
