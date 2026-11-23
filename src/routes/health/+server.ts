// Liveness probe for the Docker HEALTHCHECK (see Dockerfile): answers once the server is up.
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => new Response('ok');
