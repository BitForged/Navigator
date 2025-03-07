import {Response} from 'express';
import {getPermissionRole, PermissionRole, setPermissionRole} from "@/security";
import {getUserById} from "@/thirdparty/discord";
import {AxiosResponse} from "axios";
import {AdministratorRouter, AuthenticatedRequest} from "@/types/express";

export const adminRouter = new AdministratorRouter()

// Used to effectively "invite" a User/Discord ID for API access, but requires the ARCHITECT (Administrator) role
adminRouter.get('/authorize-user/:discordId', async (req: AuthenticatedRequest, res: Response) => {
    if (await getPermissionRole(req.user.discord_id) < PermissionRole.ARCHITECT) {
        res.status(403).json({error: 'You do not have permission to authorize users!'});
        return;
    }

    if (req.params["discordId"] === undefined) {
        res.status(400).json({error: 'Discord ID is required'});
        return;
    }

    if (isNaN(Number(req.params["discordId"]))) {
        res.status(400).json({error: 'Discord ID must be a number'});
        return;
    }

    // Do not allow a user to "authorize" themselves, because this will lower their permissions
    if (req.params["discordId"] === req.user.discord_id) {
        res.status(400).json({error: 'You cannot authorize yourself!'});
        return;
    }

    // Verify that the Discord ID actually exists if the `BOT_TOKEN` environmental variable is set
    if (process.env.BOT_TOKEN !== undefined) {
        let userRes: AxiosResponse;
        try {
            userRes = await getUserById(req.params["discordId"])
        } catch (e) {
            console.error(e)
            console.warn(`Warning: Discord ID ${req.params["discordId"]} could not be validated with the Discord API!`)
            res.status(400).json({error: 'Failed to validate Discord ID!'})
            return
        }

        await setPermissionRole(req.params["discordId"], PermissionRole.APPRENTICE);

        res.json({message: 'User authorized!', discord_id: req.params["discordId"], user: userRes.data});
    } else {
        await setPermissionRole(req.params["discordId"], PermissionRole.APPRENTICE);

        res.json({message: 'User authorized!', discord_id: req.params["discordId"]});
    }
    return
})

adminRouter.get('/disable-user/:discordId', async (req, res: Response) => {
    if (await getPermissionRole(req.user.discord_id) < PermissionRole.ARCHITECT) {
        res.status(403).json({error: 'You do not have permission to disable users!'});
        return
    }

    if (req.params["discordId"] === undefined) {
        res.status(400).json({error: 'Discord ID is required'});
        return
    }

    if (isNaN(Number(req.params["discordId"]))) {
        res.status(400).json({error: 'Discord ID must be a number'});
        return
    }

    // Users cannot deauthorize themselves
    if (req.params["discordId"] === req.user.discord_id) {
        res.status(400).json({error: 'You cannot disable yourself!'});
    }

    // Disable account in database (user role to '0')
    await setPermissionRole(req.params["discordId"], PermissionRole.NONE);
    res.json({message: 'User disabled!', discord_id: req.params["discordId"]});
})