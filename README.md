# BitJourney Navigator

Navigator is a middleware that bridges the gap between the BitJourney clients and the Stable Diffusion
backend ([Forge preferred](https://github.com/lllyasviel/stable-diffusion-webui-forge/)) API.

## Requirements

To use Navigator, you'll need a few components:

- A compatible backend that can generate images. I'm nowhere near smart enough to build that on my own, but thankfully,
  there are plenty of smart people in the Stable Diffusion space. Navigator is tested
  against [Forge](https://github.com/lllyasviel/stable-diffusion-webui-forge/) but will _probably_ work with
  Automatic1111 or other forks of A1111.

  - Do note that while _Navigator_ needs to be able to talk to Forge, downstream clients do not need access to Forge's
    API. Any API calls they require are effectively proxied through Navigator.
  - It is recommended that Navigator and Forge be on the same system, or at least have access to the same filesystem (
    if they're close latency-wise, you could use SSHFS if really necessary). Otherwise, model downloading and other
    similar features won't work properly.
  - Install any required Forge patches listed below

- A MySQL or MariaDB database

  - While Navigator and Forge don't need to be on the same system, Navigator and the database _should_ be on the same
    system unless you have a significant reason for it not to be.

- A [Discord "Application"](https://discord.com/developers/applications) since Navigator's authentication system is via
  Discord OAuth.

  - This in theory could be switched out with any other OAuth provider since the code is fairly self-contained (there
    are no actual Discord APIs used; It's purely an identity provider), though you'd need a couple of downstream
    client modifications too.
  - Grab a Client ID and Client Secret from the `OAuth` tab of your application
    - The Client ID will need to be used in downstream clients, but do not share the Client Secret with clients.
  - Specify a Redirect URL of the index page for Compass (or follow the scheme that your chosen client requires). For
    Compass, that would be `https://compass.yourdomain.tld/` as an example.
    - This needs to match on both the frontend and backend.
  - Optionally, you can grab a bot token as well if you want Navigator to try to validate that a user ID exists in the
    `/api/admin/authorize-user/:discordId` endpoint
    - If a bot token is not provided, Navigator will blindly assume that the user ID you've provided actually exists
      on Discord.

- Some sort of downstream client that is compatible with Navigator's API. Unless you intend to create your own (which
  you're welcome to do!), that will probably be [Compass](https://github.com/BitForged/Compass).

## Disclaimers

Navigator and the rest of the BitJourney stack are not enterprise software (though Navigator and Compass are AGPLv3
licensed, so if you're willing to put in some serious leg work, I suppose it _could_ be?).
Do not expect to use this stack to run a business.

A lot (I'd say 95%) of the design decisions were made by the fact that the use-case the stack was built for is to be
used by a few friends, and how it is run on our infrastructure.

Some of the design decisions even came down to me saying, "This is just the way I want to do it."

Navigator and Compass are also under constant development, and while I do not expect instances to break (as I'd like
ours to not break as well), I cannot make any guarantees.

You should, at the very least, plan to make backups of your database before upgrades.

Additionally, while instances themselves may not break (though, there are no guarantees)—you should expect to see
breaking API changes at random until the API design hits a stable point.

(I generally try to avoid pushing breaking API changes on Navigator's side until Compass' correlating changes are ready;
So, when updating one, update the other as well!)

You should keep this in mind should you try to design a downstream client for Navigator.

Finally, as with all open source projects that exist out in the world, there are no guarantees of support or updates in
general. While I'm interested in Stable Diffusion _now_, should that change later, development of this project may (
indefinitely) pause.

If any of this gives you pause, that's understandable! I try to be as upfront and transparent about things where and
when I can be. At the end of the day, I'm _sharing_ something, not _selling_ it.

## Forge Patches

- First Pass Image (`./forge_patches/add_first_pass_image_to_txt2img_api.patch`): Required
  - This patch allows the `/sdapi/v1/txt2img` endpoint to accept the base64 string of a base image when using HiRes
    Fix. When provided, instead of regenerating the original image during an upscale process, the provided copy of the
    original image is used instead, which reduces the time it takes to do an upscale.
    - Patch has already been submitted upstream to Auto1111 and is awaiting review, should it be accepted, it should
      trickle down to Forge eventually as well.

To apply patches, navigate to the directory where Forge is installed, then checkout to a known good commit, and use the
`patch` command:

```shell
$ cd /your/forge/location
$ git checkout 5e1dcd35a8535564884a4116f6bbb37dbb8dfc46
$ patch -p1 < name_of_patch.patch
```

(Then reboot Forge if it was already running)

## Installation

```bash
npm install --include=dev
cp .env.example .env
npm run prepare # Needed if you're developing/contributing to Navigator - sets up a git pre-commit hook to run prettier
```

After that, you need to fill the `.env` file with the correct values. The values should be fairly thoroughly documented
in the `.env.example` file.

Alternatively, since these just get loaded into the process' environmental variables, you can set them as environmental
variables if you prefer (such as for Docker).

Note that you should check `.env.example` for updates whenever you update Navigator, as Navigator won't attempt to write
new entries to the file (though it tries to keep reasonable behavior when its undefined).

### Docker

For convenience, there is also a Docker image built by GitHub Actions that you can use along with the Compass image for
easily getting up and running. Copy the included `./docker/compose.yaml` to a directory of your choice, then update the
`./navigator/navigator_env:/app/.env` line to point to where you've copied Navigator's `.env.example` file to.

The MariaDB and Compass images are not required — though if you choose not to use the MariaDB container, you'll still
need to provide your own MySQL/MariaDB database.

For further documentation on the environmental variables for Compass,
see [the Compass repository](https://github.com/BitForged/Compass).

It is highly recommended (though not required) you serve both Navigator and Compass over a reverse proxy of your choice,
especially for TLS connections. Ensure that your reverse proxy supports WebSocket-based connections.

You will also still need an instance of Forge as mentioned above, along with any required patches, to act as the backend
for Navigator.

## Running

```bash
npm run build # Be sure to run this any time you update Navigator, so that the TypeScript files can be transpiled!
npm run start
```

Note that since Navigator tries to run database migrations on startup, it will exit very quickly if it cannot connect to
the database.

Assuming that Navigator starts up correctly (i.e., it doesn't crash), check to see if the API is live by making a
request to `http://your_hostname:PORT/`
\- it is a simple GET request that can be executed in your browser and will return a JSON object that says "Hello
World!"

Since Navigator uses an allowlist for OAuth authentication, you'll need to grant any User IDs standard level access. To
do this, grab the `SUPERUSER_ADMIN_TOKEN` you defined and make the following request:

```shell
curl -H "Authorization: INSERT_SUPERUSER_ADMIN_TOKEN_HERE" http://instanceip:PORT/api/admin/authorize-user/DISCORD_USER_ID
```

The above endpoint requires Administrator authentication, the `SUPERUSER_ADMIN_TOKEN` acts as a static/persistent
superuser token - hence why you need to make sure its set, so that you can at least authorize yourself.

Navigator will explicitly grant the first user in the `users` table superuser privileges when using the
`.../authorize-user` endpoint. If your `users` table only contains disabled users (`role = 0`) then this will still
apply.

Alternatively, you can manually edit the database to authorize yourself (or to set a permission role that is higher than
the standard role, aside from the first authorization, since there is no API for this yet).

To disable a user's access, make the same request except to the `/api/admin/disable-user/DISCORD_USER_ID` endpoint
instead. This prevents them from logging in (and if they already have an access token, it will effectively be treated as
if they weren't logged in).
However, it **does not remove their saved data (generated images)**.

Assuming you are not designing your own downstream client, you'll probably want to set
up [Compass](https://github.com/BitForged/Compass) next.

## Concepts

Navigator operates across two ports, one for HTTP and one for WebSockets (via socket.io). The default ports are 3333 and
3334, respectively. You can change these values in the `.env` file.

Feel free to reverse proxy these! But do so with caution, do not leave the `/api/queue/txt2img` or `/api/queue/img2img`
endpoints exposed! These are only enabled if `ALLOW_LEGACY_BOT_ENDPOINTS` is set to `true` (defaults to `false`).
Those endpoints are intended to be used by the BitJourney Discord bot, which is allowed to submit job requests on behalf
of any user ID. This was the first downstream client and had no authentication (remember what was mentioned in the
disclaimer section above?).
They're firewalled on our instance to the internal network. If you enable them (it is highly unlikely you need it
enabled), then they should not be public because it requires zero authentication.

All other endpoints that trigger image generation require authentication data to be provided.

The HTTP API is used to send off tasks to be added to a queue, while the WebSocket API is used to receive updates on the
status of the tasks.

Additionally, the HTTP API is used to render both preview and final images; this will be further expanded on later in
the README.

## HTTP API

**NOTE:** The API documentation below is definitely out of date, I'm looking to provide an OpenAPI specification file
for it soon to serve as proper documentation.

The current documentation is provided below as a starting point to Navigator's API while more up-to-date documentation
is set up.

### GET /api/models

Returns a list of all available models from the Stable Diffusion backend. No parameters are required. Navigator stores a
list of models in its own database as well to provide extended attributes about the models.

An example response is as follows:

```json
{
  "models": [
    {
      "config": null,
      "filename": "/stable-diffusion-webui/models/Stable-diffusion/cyberrealisticXL_v31.safetensors",
      "friendly_name": "CyberRealistic XL",
      "hash": "95d17e744f",
      "id": 1,
      "is_restricted": false,
      "known": true,
      "model_name": "cyberrealisticXL_v31",
      "sha256": "95d17e744fba748e6d0c55126e60c794fc9c26e563dbf9c98feead78c3731e78",
      "title": "cyberrealisticXL_v31.safetensors [95d17e744f]"
    },
    {
      "config": null,
      "filename": "/stable-diffusion-webui/models/Stable-diffusion/incursiosMemeDiffusion_v27PDXL.safetensors",
      "friendly_name": "Incursios Meme Diffusion",
      "hash": "5e37c6849c",
      "id": 2,
      "is_restricted": false,
      "known": true,
      "model_name": "incursiosMemeDiffusion_v27PDXL",
      "sha256": "5e37c6849c2447e9ab180f0de8bd2dc3b4e8ff12460d5cc88e10c438b2712b32",
      "title": "incursiosMemeDiffusion_v27PDXL.safetensors [5e37c6849c]"
    }
  ]
}
```

Most of the fields actually come from the Stable Diffusion backend, but Navigator adds a few fields of its own. The
`known` field is used to determine if Navigator has seen this model before. If it has, it will have additional fields
such as `friendly_name` and `is_restricted`.
The `friendly_name` field is a human-readable name for the model, while the `is_restricted` field is a boolean that
determines if the model should be restricted to certain users.

Of course, the `is_restricted` field is up to downstream clients to enforce (Navigator does not enforce this).
A model might be restricted for a variety of reasons, such as it not being a model that is meant to be used by txt2img
generation, or it being a model that is more-than-likely to generate images unsuitable for public consumption.

Later on, Navigator will have fields to better indicate if a model should be used for txt2img generation or a different
mode, but for now, it is up to the client to determine this.

Likely in the future, Navigator will also attempt to categorize models as well, and add fields such as `nsfw_likely`.

The `known` field is used to determine if Navigator has this model in its own database. If it does not, you can still
attempt to use it, but generation may fail (or yield unexpected results).

When passing a model to any of the generation endpoints, you should use the `model_name` field as this is the field that
is used by the Stable Diffusion backend.

### POST /api/queue/txt2img

This endpoint is used to add a task to the queue for generating an image from a text-based prompt. The body of the
request should be a JSON object with the following fields:

```js
/* 
   - model_name
   - prompt (the "positive" prompt)
   - negative_prompt (optional)
   - owner_id
   - job_id (optional, if not present, Navigator will generate one on its own)
            - (if you are going to specify this, please ensure it is unique as Navigator will blindly trust that its unique)
   - width (optional, default to 512)
   - height (optional, default to 512)
   - steps (optional, default to 50)
   - seed (optional, default to -1 if not provided)
   - cfg_scale (optional, default to 7)
   - sampler_name (optional, default to "DPM++ 2M")
   - denoising_strength (optional, default to 0.0, if set to anything other than 0.0, Navigator will enforce hr_fix to be true, since denoising is from the hr_fix tool)
   - force_hr_fix (optional, default to false)
 */
```

The `model_name` field should be the `model_name` field from the `/api/models` endpoint.

The `owner_id` field should be a unique identifier for the user that is submitting the job. Navigator has no way to
enforce this, and it is up to the client to ensure that this is unique for auditing/accounting purposes.

After a job is queued, the client should listen to the WebSocket API for updates on the job. Navigator has no way of
correlating a job to a connected WebSocket client, so it is up to the client to ensure that they are listening only to
jobs known by that client.

Navigator will respond with a JSON object that contains metadata about the job that was queued. This will include the
`job_id` field, which is a unique identifier for the job.

A response will look something like this:

```json
{
  "height": 512,
  "job_id": "59feab77",
  "model_name": "cyberrealisticXL_v31",
  "owner_id": "Russ",
  "prompt": "Puppies",
  "queue_size": 1,
  "seed": -1,
  "status": "queued",
  "steps": 50,
  "task_type": "txt2img",
  "width": 512
}
```

### GET /api/images/:job_id

This endpoint is used to retrieve the image generated by a job. The `job_id` field should be the `job_id` field that was
returned by the `/api/queue/txt2img` endpoint.

Navigator will automatically send the image as `image/png` content that browsers can render. Note that this endpoint
will return a 404 if the job has not finished yet or if the job does not exist.

### GET /api/previews/:job_id

This endpoint is used to retrieve the preview image generated by the Stable Diffusion backend. Navigator will
automatically attempt to retrieve the preview image from the backend, and will return it as `image/png` content that
browsers can render.

The latest preview retrieved from the Stable Diffusion backend will always be returned by this endpoint. Note that this
endpoint will return a 404 if the job has no preview yet (such as if the job is still waiting in the queue), or if the
job does not exist.

### GET /3papi/civitai/download/:modelId

This endpoint is used to download a model from the CivitAI API.

This request will fail if the `CIVITAI_API_KEY` environment variable is not set (or if it is invalid), or if the model
type is unsupported, or if the system has less than 10% storage space free.

## WebSocket/Socket.io API

The WebSocket API is used to receive updates on the status of a job. The client should connect to the WebSocket API and
listen for updates on the job.

**Note**: Navigator has no way of correlating a job to a connected WebSocket client, so it is up to the client to ensure
that they are listening only to jobs known by that client. Navigator will emit events for all jobs, regardless of the
client.

The WebSocket API emits the following events:

**Note**: All events will contain a `job_id` field that is unique to the job (that was obtained when the client queued
the job), if it is an event related to a job.

`models-refreshed`: This event is emitted when Navigator triggers a refresh of models on the backend, this is done so
that downstream clients know to reload their list of available models.
No actual data is sent with this event.

`model-changed`: This event is emitted when Navigator believes that the Stable Diffusion model needs to be changed on
the backend. This indicates that the job might take a bit longer to start.
The `model_name` field is included, which indicates what Navigator believes the backend is switching to. This is the
best guess and may not be accurate.
The `job_id` field is also included, which indicates what job this change is related to.

```json
[
  {
    "model_name": "cyberrealisticXL_v31",
    "job_id": "cf2646a2"
  }
]
```

`task-started`: This event is emitted when the job has started on the backend.

```json
[
  {
    "model_name": "cyberrealisticXL_v31",
    "prompt": "Puppies",
    "owner_id": "Russ",
    "job_id": "342ee798",
    "width": 512,
    "height": 512,
    "steps": 50,
    "seed": -1,
    "queue_size": 1,
    "task_type": "txt2img",
    "status": "started"
  }
]
```

`task-progress`: This event is emitted when the job has made progress on the backend. It will contain the `current_step`
that the job is on, as well as the `total_steps` that the job will take.
There is also a `progress` field that is a percentage of the job that has been completed (Values 0–1, clients should
multiply the value by 100 before showing to the end-user).
Also supplied is a `eta_relative` field which is provided by the backend, and is a relative time to completion. This may
be inaccurate, but it is the best estimate that the backend can provide.
Finally, a `progress_path` is provided, which is a URL to the preview image that is generated by the backend. This is
the latest preview image that the backend has generated.

```json
[
  {
    "model_name": "cyberrealisticXL_v31",
    "prompt": "Puppies",
    "owner_id": "Russ",
    "job_id": "cf2646a2",
    "width": 512,
    "height": 512,
    "steps": 50,
    "seed": -1,
    "task_type": "txt2img",
    "status": "processing",
    "progress": 0.19,
    "eta_relative": 9.849347967850534,
    "current_step": 9,
    "total_steps": 50,
    "progress_path": "/api/previews/cf2646a2"
  }
]
```

`task-finished`: This event is emitted when the job has finished on the backend. The client should then use the
`/api/images/:job_id` endpoint to retrieve the image (the `img_path` will also contain this).

```json
[
  {
    "model_name": "cyberrealisticXL_v31",
    "prompt": "Puppies",
    "owner_id": "Russ",
    "job_id": "cf2646a2",
    "width": 512,
    "height": 512,
    "steps": 50,
    "seed": -1,
    "task_type": "txt2img",
    "status": "finished",
    "img_path": "/api/images/cf2646a2"
  }
]
```

`task-failed`: This event is emitted when the job has failed on the backend (to the best of Navigator's knowledge). It
may also be emitted if an error occurred on Navigator's side. The `error` field will contain the error message (if we
can provide one).

```json
[
  {
    "model_name": "cyberrealisticXL_v31",
    "prompt": "Puppies",
    "owner_id": "Russ",
    "job_id": "59feab77",
    "width": 512,
    "height": 512,
    "steps": 50,
    "seed": -1,
    "task_type": "txt2img",
    "status": "failed",
    "error": {
      "code": "ECONNREFUSED",
      "fatal": true
    }
  }
]
```
