import { JwtPayload } from "jsonwebtoken";
import express, { Request, Response, NextFunction, Router } from "express";
import { isAdministrator, isAuthenticated } from "@/security";

export interface RequestParams {}
export interface ResponseBody {}
export interface RequestBody {}

export interface NavigatorUser extends JwtPayload {
  discord_id: string;
}

export function isJwtNavigatorUser(user: any): user is NavigatorUser {
  return user.discord_id !== undefined;
}

export interface AuthenticatedRequest extends Request {
  user: NavigatorUser;
}

declare global {
  namespace Express {
    interface Request {
      user?: NavigatorUser;
    }
  }
}

export class AuthenticatedRouter {
  private router: Router;

  constructor() {
    this.router = express.Router();
  }

  get(
    path: string,
    handler: (req: AuthenticatedRequest, res: Response) => void,
  ) {
    this.router.get(
      path,
      isAuthenticated,
      async (req: Request, res: Response, _: NextFunction) => {
        handler(req as AuthenticatedRequest, res);
      },
    );
  }

  post(
    path: string,
    handler: (req: AuthenticatedRequest, res: Response) => void,
  ) {
    this.router.post(
      path,
      isAuthenticated,
      async (req: Request, res: Response, _: NextFunction) => {
        handler(req as AuthenticatedRequest, res);
      },
    );
  }

  getRouter() {
    return this.router;
  }
}

export class AdministratorRouter {
  private router: Router;

  constructor() {
    this.router = express.Router();
  }

  get(
    path: string,
    handler: (req: AuthenticatedRequest, res: Response) => void,
  ) {
    this.router.get(
      path,
      isAuthenticated,
      isAdministrator,
      async (req: Request, res: Response, _: NextFunction) => {
        handler(req as AuthenticatedRequest, res);
      },
    );
  }

  post(
    path: string,
    handler: (req: AuthenticatedRequest, res: Response) => void,
  ) {
    this.router.post(
      path,
      isAuthenticated,
      isAdministrator,
      async (req: Request, res: Response, _: NextFunction) => {
        handler(req as AuthenticatedRequest, res);
      },
    );
  }

  getRouter() {
    return this.router;
  }
}
