/** Shapes returned by the VIM Server REST API (only the fields this app uses). */

/** GET /api/v1/config — anonymous; the Entra app registration the server trusts. */
export type ServerConfig = {
  tenantId: string
  clientId: string
}

export type Profile = {
  userId?: string
  firstName?: string
  lastName?: string
  email?: string
  organizations?: { id: string; name: string; role: string }[]
}

export type OrgSummary = {
  id: string
  name: string
  role: string
}

/** One VIM snapshot (an uploaded/converted blob). */
export type BlobSummary = {
  id: string
  name: string
  versionTag: string
  sizeInBytes: number
  created: string
}

export type ProjectSummary = {
  id: string
  name: string
  status: string
  role: string
  sourceCount: number
  created: string
  lastModified: string
  latestVim: BlobSummary | null
}

export type ProjectDetail = {
  id: string
  name: string
  status: string
  organizationId: string
  created: string
  lastModified: string
  latestVim: BlobSummary | null
}

/** GET /project/{id}/vim */
export type VimHistory = {
  latest: BlobSummary | null
  history: BlobSummary[]
}

/** GET /project/{id}/vim/download?redirect=false — a time-limited SAS URL. */
export type DownloadUrl = {
  url: string
  expiresAtUtc: string
}

/** "Viewer" | "Manager" | "Admin"; the server may add more, so keep it a string. */
export type ProjectRole = {
  projectId: string
  role: string
}

/** One entry of the project custom data store, with its write-version ETag. */
export type DataEntry<T> = {
  key: string
  value: T
  /** Quoted integer, e.g. `"3"`. Absent when the server did not send one. */
  etag?: string
}
