export interface GridDefinition {
  key: string;
  label: string;
  path: string;
}

export const GRID_DEFINITIONS: GridDefinition[] = [
  {
    key: 'staging-processing-errors',
    label: 'Staging Processing Errors',
    path: '/crossng-datahub/internal/api/executionLogs/stagingProcessingErrors'
  },
  {
    key: 'data-processing-errors',
    label: 'Data Processing Errors',
    path: '/crossng-datahub/internal/api/executionLogs/dataProcessingErrors'
  },
  {
    key: 'consistency-check-errors',
    label: 'Consistency Check Errors',
    path: '/crossng-datahub/internal/api/consistencyCheck/consistencyErrors'
  },
  {key: 'timeout-errors', label: 'Timeout Errors', path: '/crossng-datahub/internal/api/executionLogs/timeoutErrors'},
  {key: 'export-errors', label: 'Export Errors', path: '/crossng-datahub/internal/api/export/errors'},
];
