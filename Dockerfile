FROM node:23

ARG NAVIGATOR_BRANCH
ARG NAVIGATOR_COMMIT_SHA

ENV BRANCH     $NAVIGATOR_BRANCH
ENV COMMIT_SHA $NAVIGATOR_COMMIT_SHA

WORKDIR /app
COPY src/          /app/src/
COPY package*.json /app/
COPY tsconfig.json /app/
COPY migrations/   /app/migrations/

RUN ["npm", "install", "--include=dev"]
RUN ["npm", "run", "build"]
CMD ["npm", "run", "start"]