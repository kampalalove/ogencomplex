export const REGIONS = ["us-east-1", "eu-west-1", "ap-south-1"];
export const DEFAULT_REGION = "us-east-1";
export const REQUIRED_RELEASE_REGIONS = [...REGIONS];

export function isValidRegion(region) {
  return region === "all" || REGIONS.includes(region);
}

export function validateRegion(region) {
  const value = region || DEFAULT_REGION;

  if (!isValidRegion(value)) {
    const allowed = [...REGIONS, "all"].join(", ");
    const error = new Error(
      `Invalid region "${value}". Allowed values: ${allowed}`
    );
    error.statusCode = 400;
    throw error;
  }

  return value;
}

export function expandRegions(region) {
  const value = validateRegion(region);

  if (value === "all") {
    return [...REGIONS];
  }

  return [value];
}

export function isRequiredReleaseRegion(region) {
  return REQUIRED_RELEASE_REGIONS.includes(region);
}