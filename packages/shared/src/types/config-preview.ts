export type ConfigPreviewFileStatus = 'managed' | 'merged' | 'project';

export type ConfigPreviewFile = {
  path: string;
  scope: 'home' | 'workspace';
  content: string;
  status: ConfigPreviewFileStatus;
  overriddenFields?: string[];
};

export type ConfigPreviewResponse = {
  ok: boolean;
  runtime: string;
  files: ConfigPreviewFile[];
};
