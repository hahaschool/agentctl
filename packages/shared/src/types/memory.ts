export type MemoryObservation = {
  id: number;
  type: string;
  title: string;
  subtitle?: string;
  facts?: string;
  narrative?: string;
  files_modified?: string;
  created_at: string;
};
