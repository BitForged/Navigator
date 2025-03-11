import {verify} from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import {asyncQuery} from "@/database";
import {User} from "@/types/database";
import {isJwtNavigatorUser} from "@/types/express";

const SECRET_KEY = process.env.SECRET_KEY
const SUPERUSER_KEY = process.env.SUPERUSER_ADMIN_TOKEN

/**
 * Middleware function to check if a user is authenticated based on the `Authorization` header.
 * If the user is authenticated, the user's information is attached to the `req.user` object.
 * Otherwise, responds with a 401 Unauthorized status.
 *
 * @param {Request} req - The HTTP request object containing headers, parameters, and body.
 * @param {Response} res - The HTTP response object used to send responses to the client.
 * @param {NextFunction} next - The callback to pass control to the next middleware.
 * @return {Promise<void>} Does not return a value but modifies the `req` object or sends an HTTP response.
 */
export async function isAuthenticated(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (req.headers.authorization === undefined) {
        res.status(401).json({message: 'Unauthorized'});
        return;
    }
    if(req.headers.authorization === SUPERUSER_KEY && req.headers.authorization !== undefined && req.headers.authorization.length > 0) {
        req.user = {
            discord_id: SUPERUSER_KEY,
            role: PermissionRole.APEX,
        }
        next();
        return;
    }
    const token = req.headers.authorization.split(' ')[1];
    verify(token, SECRET_KEY, async (err, user) => {
        if (err) {
            res.status(401).json({message: 'Unauthorized', error: err.message});
            return;
        }
        if (typeof user !== 'string' && user !== undefined && isJwtNavigatorUser(user)) {
            // Reject access if permission role is 0 / NONE
            if (await getPermissionRole(user.discord_id) === PermissionRole.NONE) {
                res.status(401).json({message: 'Unauthorized', error: 'User is disabled'});
                return;
            }
            req.user = user;
        } else {
            // This shouldn't happen unless someone has tampered with their token?
            console.error("Invalid user type: " + typeof user + " " + user)
            res.status(401).json({message: 'Unauthorized', error: "Malformed token!"}); // Treat as effectively unauthenticated
        }
        next();
    });
}

export async function isArtificer(req: Request, res: Response, next: NextFunction): Promise<void> {
    if(await getPermissionRole(req.user?.discord_id) < PermissionRole.ARTIFICER) {
        res.status(401).json({message: 'Unauthorized'});
        return;
    }
    next();
}

/**
 * Middleware function to check if a user has administrator permissions.
 *
 * @param {Request} req - The HTTP request object containing user details.
 * @param {Response} res - The HTTP response object used to send responses.
 * @param {NextFunction} next - The next middleware function in the request-response cycle.
 * @return {Promise<void>} Resolves to void if the user is authorized, otherwise sends an unauthorized response.
 */
export async function isAdministrator(req: Request, res: Response, next: NextFunction): Promise<void> {
    if(await getPermissionRole(req.user?.discord_id) < PermissionRole.ARCHITECT) {
        res.status(401).json({message: 'Unauthorized'});
        return;
    }

    next();
}

/**
 * Checks if the user with the specified ID has existing data in the `images` table.
 * Queries the database to determine whether the user owns any images, returning true if at least one image exists.
 *
 * @param {string} userId - The ID of the user to check for existing data.
 * @return {Promise<boolean>} A promise that resolves to true if the user has existing data, otherwise false.
 */
export async function hasExistingData(userId: string): Promise<boolean> {
    // Check `images` table in database to see if the user id owns any images (limit by 1), return true if so
    let results = await asyncQuery(`SELECT * FROM images WHERE owner_id = ? LIMIT 1`, [userId])
    return results.length > 0;
}

/**
 * Retrieves the permission role associated with a specific user ID.
 * If the user does not exist in the database but has existing data,
 * the user is assigned a default role and added to the database.
 *
 * Will automatically return `PermissionRole.APEX` (highest role) if the ID is the token from the SUPERUSER_ADMIN_TOKEN
 *  environmental variable
 *
 * @param {string} userId - The unique identifier of the user whose role is to be retrieved.
 * @return {Promise<PermissionRole>} A promise that resolves to the user's permission role. If the user does not exist and has no existing data, it resolves to `PermissionRole.NONE`.
 */
export async function getPermissionRole(userId?: string): Promise<PermissionRole> {
    if(userId === undefined) {
        return PermissionRole.NONE;
    }

    if(userId === SUPERUSER_KEY) {
        return PermissionRole.APEX;
    }

    const users = await asyncQuery(`SELECT * FROM users WHERE id = ?`, [userId]) as Array<User>;
    if(users.length === 0) {
        if(await hasExistingData(userId)) {
            await asyncQuery(`INSERT INTO users (id, role) VALUES (?, ?)`, [userId, PermissionRole.APPRENTICE])
            console.log(`[Authentication] Created new user with ID ${userId} and role ${PermissionRole.APPRENTICE} (had existing image data)`)
            return PermissionRole.APPRENTICE;
        } else {
            return PermissionRole.NONE;
        }
    } else {
        return users[0].role
    }
}

/**
 * Updates the permission role of a user in the database. If the user already exists, their role is updated - otherwise
 *  the user is added into the users table.
 *
 * @param {string} userId - The unique identifier of the user whose role is being set or updated.
 * @param {PermissionRole} role - The role to be assigned to the user.
 * @return {Promise<void>} A promise that resolves when the operation is completed.
 */
export async function setPermissionRole(userId: string, role: PermissionRole): Promise<void> {
    await asyncQuery(`INSERT INTO users (id, role) VALUES (?, ?) ON DUPLICATE KEY UPDATE role = ?`, [userId, role, role])
    return
}

/**
 * Defines the permission roles for Navigator.
 * Each role is associated with a specific integer value that represents
 * the level of access or permissions granted to a user.
 *
 * Enum Values:
 * NONE: Represents an unauthenticated or disabled state with no permissions.
 * APPRENTICE: Standard or default role assigned to users with basic permissions (generating images).
 * ARTIFICER: Denotes a higher-level role with elevated permissions, such as managing resources.
 * ARCHITECT: Administrator role with access to advanced configuration and administrative capabilities.
 * APEX: Represents the superuser role with the highest level of access and permissions.
 */
export enum PermissionRole {
    NONE = 0,      // Unauthenticated (or disabled)
    APPRENTICE = 1,// "Standard" / default role
    ARTIFICER = 2, // Elevated permissions role (such as triggering model downloads)
    ARCHITECT = 3, // Administrator role
    APEX = 4       // Superuser role
}