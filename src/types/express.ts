import {JwtPayload} from "jsonwebtoken";

export interface RequestParams {}
export interface ResponseBody {}
export interface RequestBody {}

declare global {
    namespace Express {
        interface Request {
            email: string
            password: string
            user?: JwtPayload
        }
    }
}