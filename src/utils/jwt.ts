import jwt from "jsonwebtoken";

const ACCESS_SECRET = process.env.JWT_SECRET || "supersecret"; // use .env
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "refreshsupersecret";

const ACCESS_EXPIRY = "15m";  // short-lived
const REFRESH_EXPIRY = "7d";  // long-lived

// ✅ Generate Access Token (used in Authorization header)
export function generateAccessToken(payload: object) {
    return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRY });
}

// ✅ Generate Refresh Token (stored in HttpOnly cookie)
export function generateRefreshToken(payload: object) {
    return jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRY });
}

// ✅ Verify Access Token
export function verifyAccessToken(token: string) {
    try {
        return jwt.verify(token, ACCESS_SECRET);
    } catch {
        return null;
    }
}

// ✅ Verify Refresh Token
export function verifyRefreshToken(token: string) {
    try {
        return jwt.verify(token, REFRESH_SECRET);
    } catch {
        return null;
    }
}
