// The REST API docs of a chip as an OpenAPI 3.0 document (downloaded from `ApiTab.svelte`).
import type { DeviceApiParam, DeviceApiRoute } from '../../../types';

export type DocRoute = DeviceApiRoute & { feature: string };

const plain = (s: string) => s.replace(/`/g, '');
const schemaType = (p: DeviceApiParam) => (p.type === 'number' ? 'integer' : p.type);

export function openApi(routes: DocRoute[], title: string, server: string): object {
	const paths: Record<string, Record<string, unknown>> = {};
	for (const r of routes) {
		const op: Record<string, unknown> = {
			tags: [r.feature],
			summary: r.summary,
			...(r.description ? { description: plain(r.description) } : {}),
			security:
				r.access === 'public'
					? []
					: [{ cookie: [] }, ...(r.access === 'admin' ? [{ basic: [] }] : [])],
			responses: {
				'200': {
					description: 'OK',
					content: { 'application/json': r.response === undefined ? {} : { example: r.response } }
				},
				default: { $ref: '#/components/responses/Error' }
			}
		};
		if (r.params?.length) {
			op.requestBody = {
				required: true,
				content: {
					'application/x-www-form-urlencoded': {
						schema: {
							type: 'object',
							properties: Object.fromEntries(
								r.params.map((p) => [
									p.name,
									{ type: schemaType(p), description: plain(p.description) }
								])
							),
							required: r.params.filter((p) => p.required).map((p) => p.name)
						}
					}
				}
			};
		}
		if (r.rawBody) {
			op.requestBody = {
				required: true,
				description: plain(r.rawBody.description),
				content: { [r.rawBody.type]: { schema: { type: 'string', format: 'binary' } } }
			};
		}
		(paths[r.path] ??= {})[r.method.toLowerCase()] = op;
	}
	return {
		openapi: '3.0.3',
		info: { title, version: '1.0.0' },
		servers: [{ url: server }],
		paths,
		components: {
			securitySchemes: {
				cookie: { type: 'apiKey', in: 'cookie', name: 'mesp_session' },
				basic: { type: 'http', scheme: 'basic' }
			},
			responses: {
				Error: {
					description: 'Error, e.g. 401 (not logged in) or 403 (not allowed)',
					content: {
						'application/json': {
							schema: { type: 'object', properties: { error: { type: 'string' } } }
						}
					}
				}
			}
		}
	};
}
