import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../config/db';
import { UserPayload, authenticate, AuthRequest } from '../middleware/auth';
import { z } from 'zod';

const router = Router();

// A simple in-memory store for OTPs for demonstration purposes.
// In a real application, use Redis for this with a TTL.
const otpStore: Record<string, { otp: string; expires: number }> = {};

const OTPSchema = z.object({
    phone: z.string().min(10, "Phone number must be at least 10 digits"),
});

// Endpoint to send OTP
router.post('/send-otp', async (req, res) => {
    try {
        const { phone } = OTPSchema.parse(req.body);

        // In a real app, you would use an SMS gateway like Twilio here.
        // For this demo, we'll generate a simple OTP and log it.
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expires = Date.now() + 5 * 60 * 1000; // 5 minutes expiry

        otpStore[phone] = { otp, expires };

        console.log(`📱 OTP for ${phone} is: ${otp}`); // Simulate sending OTP

        res.json({ message: 'OTP sent successfully' });
    } catch (err) {
        if (err instanceof z.ZodError) {
            return res.status(400).json({ error: err.issues });
        }
        console.error('Error sending OTP:', err); // Log the full error object
        res.status(500).json({ error: 'Failed to send OTP' });
    }
});

const VerifyOTPSchema = z.object({
    phone: z.string().min(10),
    otp: z.string().length(6),
});

// Endpoint to verify OTP and log in/sign up the user
router.post('/verify-otp', async (req, res) => {
    try {
        const { phone, otp } = VerifyOTPSchema.parse(req.body);

        const storedOtp = otpStore[phone];

        if (!storedOtp || storedOtp.otp !== otp || Date.now() > storedOtp.expires) {
            return res.status(400).json({ error: 'Invalid or expired OTP' });
        }

        // OTP is valid, clean it up
        delete otpStore[phone];

        // Find or create the user
        let userResult = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
        let user = userResult.rows[0];
        const isNewUser = !user;

        if (!user) {
            // User doesn't exist, create a new one
            userResult = await pool.query(
                'INSERT INTO users (phone) VALUES ($1) RETURNING *',
                [phone]
            );
            user = userResult.rows[0];
        }

        const requiresNameSetup = isNewUser || !user.name;

        // User exists, create JWT
        const payload: UserPayload = {
            id: user.id,
            phone: user.phone,
        };

        const token = jwt.sign(payload, process.env.JWT_SECRET as string, {
            expiresIn: '1d', // Token expires in 1 day
        });

        // You might also want a refresh token
        const refreshToken = jwt.sign(payload, process.env.REFRESH_TOKEN_SECRET as string, {
            expiresIn: '7d',
        });

        res.json({
            message: 'Login successful',
            token,
            refreshToken,
            user: {
                id: user.id,
                phone: user.phone,
                name: user.name,
            },
            isNewUser: requiresNameSetup,
        });
    } catch (err) {
        if (err instanceof z.ZodError) {
            return res.status(400).json({ error: err.issues });
        }
        console.error('Error verifying OTP:', err);
        res.status(500).json({ error: 'Failed to verify OTP' });
    }
});

const RefreshTokenSchema = z.object({
    refreshToken: z.string(),
});

// Endpoint to refresh the access token
router.post('/refresh', async (req, res) => {
    try {
        const { refreshToken } = RefreshTokenSchema.parse(req.body);

        if (!refreshToken) {
            return res.status(401).json({ error: 'Refresh token required' });
        }

        const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET as string) as UserPayload;

        // The refresh token is valid, get user data
        const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.id]);
        const user = rows[0];

        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }

        // Create a new short-lived access token
        const payload: UserPayload = { id: user.id, phone: user.phone };
        const token = jwt.sign(payload, process.env.JWT_SECRET as string, {
            expiresIn: '1d', // Or a shorter time like '15m'
        });

        res.json({
            message: 'Token refreshed successfully',
            token,
            user: { id: user.id, phone: user.phone, name: user.name },
        });

    } catch (err) {
        if (err instanceof jwt.JsonWebTokenError) {
            return res.status(401).json({ error: 'Invalid or expired refresh token' });
        }
        console.error('Error refreshing token:', err);
        res.status(500).json({ error: 'Failed to refresh token' });
    }
});

const SetNameSchema = z.object({
    name: z.string().min(1, "Name cannot be empty"),
});

// Endpoint to set user's name after initial signup
router.post('/set-name', authenticate, async (req: AuthRequest, res) => {
    try {
        const { name } = SetNameSchema.parse(req.body);
        const userId = req.user?.id;

        if (!userId) {
            // This case should ideally be caught by the authenticate middleware
            return res.status(401).json({ error: 'User not authenticated' });
        }

        const { rows } = await pool.query(
            'UPDATE users SET name = $1 WHERE id = $2 RETURNING id, phone, name',
            [name, userId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            message: 'Name updated successfully',
            user: rows[0],
        });

    } catch (err) {
        if (err instanceof z.ZodError) {
            return res.status(400).json({ error: err.issues });
        }
        console.error('Error setting name:', err);
        res.status(500).json({ error: 'Failed to set name' });
    }
});

export default router;