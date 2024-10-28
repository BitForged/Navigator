# BitJourney Navigator

Navigator is a middleware that bridges the gap between the BitJourney clients and the Stable Diffusion backend API.

## Installation

```bash
npm install
cp .env.example .env
```

After that, you need to fill the `.env` file with the correct values. The values should be self-explanatory.

## Running

```bash
npm run start
```

## Concepts
Navigator operates across two ports, one for HTTP and one for WebSockets (via socket.io). The default ports are 3333 and 3334, respectively. You can change these values in the `.env` file.

The HTTP API is used to send off tasks to be added to a queue, while the WebSocket API is used to receive updates on the status of the tasks.

Additionally, the HTTP API is used to render both preview and final images; this will be further expanded on later in the README.

## HTTP API

### GET /api/models

Returns a list of all available models from the Stable Diffusion backend. No parameters are required. Navigator stores a list of models in its own database as well, to provide extended attributes about the models.

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
Most of the fields actually come from the Stable Diffusion backend, but Navigator adds a few fields of its own. The `known` field is used to determine if Navigator has seen this model before. If it has, it will have additional fields such as `friendly_name` and `is_restricted`.
The `friendly_name` field is a human-readable name for the model, while the `is_restricted` field is a boolean that determines if the model should be restricted to certain users.

Of course, the `is_restricted` field is up to downstream clients to enforce (Navigator does not enforce this).
A model might be restricted for a variety of reasons, such as it not being a model that is meant to be used by txt2img generation, or it being a model that is more-than-likely to generate images unsuitable for public consumption.

Later on, Navigator will have fields to better indicate if a model should be used for txt2img generation or a different mode, but for now, it is up to the client to determine this.

Likely in the future, Navigator will also attempt to categorize models as well, and add fields such as `nsfw_likely`.

The `known` field is used to determine if Navigator has this model in its own database. If it does not, you can still attempt to use it, but generation may fail (or yield unexpected results).

When passing a model to any of the generation endpoints, you should use the `model_name` field as this is the field that is used by the Stable Diffusion backend.

### POST /api/queue/txt2img

This endpoint is used to add a task to the queue for generating an image from text. The body of the request should be a JSON object with the following fields:

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
   - sampler_name (optional, default to "k_dpmpp_2m")
   - denoising_strength (optional, default to 0.0, if set to anything other than 0.0, Navigator will enforce hr_fix to be true, since denoising is from the hr_fix tool)
   - force_hr_fix (optional, default to false)
 */
```

The `model_name` field should be the `model_name` field from the `/api/models` endpoint. 

The `owner_id` field should be a unique identifier for the user that is submitting the job. Navigator has no way to enforce this, and it is up to the client to ensure that this is unique for auditing/accounting purposes.

After a job is queued, the client should listen to the WebSocket API for updates on the job. Navigator has no way of correlating a job to a connected WebSocket client, so it is up to the client to ensure that they are listening only to jobs known by that client.

Navigator will respond with a JSON object that contains metadata about the job that was queued. This will include the `job_id` field, which is a unique identifier for the job.

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

This endpoint is used to retrieve the image generated by a job. The `job_id` field should be the `job_id` field that was returned by the `/api/queue/txt2img` endpoint.

Navigator will automatically send the image as `image/png` content that browsers can render. Note that this endpoint will return a 404 if the job has not finished yet, or if the job does not exist.

### GET /api/previews/:job_id

This endpoint is used to retrieve the preview image generated by the Stable Diffusion backend. Navigator will automatically attempt to retrieve the preview image from the backend, and will return it as `image/png` content that browsers can render.

The latest preview retrieved from the Stable Diffusion backend will always be returned by this endpoint. Note that this endpoint will return a 404 if the job has no preview yet (such as if the job is still waiting in the queue), or if the job does not exist.

## WebSocket/Socket.io API

The WebSocket API is used to receive updates on the status of a job. The client should connect to the WebSocket API and listen for updates on the job.

**Note**: Navigator has no way of correlating a job to a connected WebSocket client, so it is up to the client to ensure that they are listening only to jobs known by that client. Navigator will emit events for all jobs, regardless of the client.

The WebSocket API emits the following events:

**Note**: All events will contain a `job_id` field that is unique to the job (that was obtained when the client queued the job), if it is an event related to a job.

`model-changed`: This event is emitted when Navigator believes that the Stable Diffusion model needs to be changed on the backend. This indicates that the job might take a bit longer to start.
The `model_name` field is included, which indicates what Navigator believes the backend is switching to. This is the best guess and may not be accurate.
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

`task-progress`: This event is emitted when the job has made progress on the backend. It will contain the `current_step` that the job is on, as well as the `total_steps` that the job will take. 
There is also a `progress` field that is a percentage of the job that has been completed (Values 0–1, clients should multiply the value by 100 before showing to the end-user). 
Also supplied is a `eta_relative` field which is provided by the backend, and is a relative time to completion. This may be inaccurate, but it is the best estimate that the backend can provide.
Finally, a `progress_path` is provided, which is a URL to the preview image that is generated by the backend. This is the latest preview image that the backend has generated.

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

`task-finished`: This event is emitted when the job has finished on the backend. The client should then use the `/api/images/:job_id` endpoint to retrieve the image (the `img_path` will also contain this).

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

`task-failed`: This event is emitted when the job has failed on the backend (to the best of Navigator's knowledge). It may also be emitted if an error occurred on Navigator's side. The `error` field will contain the error message (if we can provide one).

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