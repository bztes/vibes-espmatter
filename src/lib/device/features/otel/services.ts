import { defineFirmwareApi } from '../../services';

/** OpenTelemetry (`espm_otel.h`): for features whose firmware records metrics. */
export const otel = defineFirmwareApi('otel.metrics', 'otel');
