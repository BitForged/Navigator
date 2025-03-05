import {verify} from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';

const SECRET_KEY = process.env.SECRET_KEY

function isAuthenticated(req: Request, res: Response, next: NextFunction): void {
    if (req.headers.authorization === undefined) {
        res.status(401).json({message: 'Unauthorized'});
        return;
    }
    const token = req.headers.authorization.split(' ')[1];
    verify(token, SECRET_KEY, (err, user) => {
        if (err) {
            res.status(401).json({message: 'Unauthorized', error: err.message});
            return;
        }
        if(typeof user !== 'string' && user !== undefined) {
            req.user = user;
        } else {
            // This shouldn't happen unless someone has tampered with their token?
            console.error("Invalid user type: " + typeof user + " " + user)
            res.status(401).json({message: 'Unauthorized', error: "Malformed token!"}); // Treat as effectively unauthenticated
        }
        next();
    });
}

export {
    isAuthenticated,
}