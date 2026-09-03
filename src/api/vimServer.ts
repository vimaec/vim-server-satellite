/** Typed wrappers over the VIM Server endpoints this app calls. */
import { apiFetch } from './http'
import type {
  DownloadUrl,
  OrgSummary,
  Profile,
  ProjectDetail,
  ProjectRole,
  ProjectSummary,
  ServerConfig,
  VimHistory,
} from './types'

/** Anonymous. Tells the app which Entra app registration to sign in against. */
export function getConfig(): Promise<ServerConfig> {
  return apiFetch<ServerConfig>('/config', { anonymous: true })
}

/** The signed-in user: name, email and the organisations they belong to. */
export function getProfile(): Promise<Profile> {
  return apiFetch<Profile>('/profile')
}

export function listOrgs(): Promise<OrgSummary[]> {
  return apiFetch<OrgSummary[]>('/org')
}

export function listProjects(orgId: string): Promise<ProjectSummary[]> {
  return apiFetch<ProjectSummary[]>(`/org/${orgId}/project`)
}

export type OrgProjects = { org: OrgSummary; projects: ProjectSummary[] }

/**
 * There is no "all my projects" endpoint, so fan out over the orgs.
 * An org whose project list fails is shown empty rather than failing the page.
 */
export async function listAccessibleProjects(): Promise<OrgProjects[]> {
  const orgs = await listOrgs()
  return Promise.all(
    orgs.map(async (org) => ({
      org,
      projects: await listProjects(org.id).catch(() => [] as ProjectSummary[]),
    })),
  )
}

export function getProject(projectId: string): Promise<ProjectDetail> {
  return apiFetch<ProjectDetail>(`/project/${projectId}`)
}

export function getProjectRole(projectId: string): Promise<ProjectRole> {
  return apiFetch<ProjectRole>(`/project/${projectId}/role`)
}

export function getVimHistory(projectId: string): Promise<VimHistory> {
  return apiFetch<VimHistory>(`/project/${projectId}/vim`)
}

/**
 * Resolves the snapshot download URL. `redirect=false` asks for the SAS URL as
 * JSON instead of a 302: the viewer needs the URL itself, and following a
 * redirect from fetch would strip nothing but also tell us nothing.
 * Omit `blobId` for the latest snapshot.
 */
export function getVimDownloadUrl(projectId: string, blobId?: string): Promise<DownloadUrl> {
  const query = new URLSearchParams({ redirect: 'false' })
  if (blobId) query.set('blobId', blobId)
  return apiFetch<DownloadUrl>(`/project/${projectId}/vim/download?${query.toString()}`)
}
