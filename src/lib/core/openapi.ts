/** The device's REST API as an OpenAPI 3.1 document (for tools like Swagger UI or code generators). */
import type { ApiRoute } from '#sdk';
import type { Assembly } from './assemble';

export function openApi(a: Assembly, serverUrl = 'http://device.local'): Record<string, unknown> {
	const paths: Record<string, Record<string, unknown>> = {};
	for (const route of a.api) {
		const item = (paths[route.path] ??= {});
		item[route.method.toLowerCase()] = operation(route);
	}
	return {
		openapi: '3.1.0',
		info: {
			title: `${a.resolved.config.name} REST API`,
			version: '1',
			description: `REST API of the ${a.resolved.config.kind === 'hub' ? 'Matter hub' : 'Matter device'} "${a.resolved.config.name}". Authenticate with \`Authorization: Bearer <API token>\`.`
		},
		servers: [{ url: serverUrl }],
		components: {
			securitySchemes: { token: { type: 'http', scheme: 'bearer' } }
		},
		paths
	};
}

function operation(route: ApiRoute) {
	const query =
		route.params?.filter(
			(p) => (p.in ?? (route.method === 'GET' ? 'query' : 'body')) === 'query'
		) ?? [];
	const body =
		route.params?.filter((p) => (p.in ?? (route.method === 'GET' ? 'query' : 'body')) === 'body') ??
		[];
	const op: Record<string, unknown> = {
		summary: route.summary,
		description: route.description,
		tags: [route.source ?? 'Platform'],
		security: route.auth === 'token' ? [{ token: [] }] : [],
		responses: {
			'200': {
				description: 'OK',
				content: route.response ? { 'application/json': { example: route.response } } : undefined
			},
			...(route.auth === 'token' ? { '401': { description: 'Missing or wrong token' } } : {})
		}
	};
	if (query.length)
		op.parameters = query.map((p) => ({
			name: p.name,
			in: 'query',
			required: !!p.required,
			description: p.description,
			schema: { type: p.type }
		}));
	if (body.length)
		op.requestBody = {
			content: {
				'application/json': {
					schema: {
						type: 'object',
						required: body.filter((p) => p.required).map((p) => p.name),
						properties: Object.fromEntries(
							body.map((p) => [p.name, { type: p.type, description: p.description }])
						)
					}
				}
			}
		};
	if (route.rawBody)
		op.requestBody = {
			description: route.rawBody.description,
			content: { [route.rawBody.contentType]: { schema: { type: 'string', format: 'binary' } } }
		};
	return op;
}
