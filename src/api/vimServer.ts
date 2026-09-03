/** Typed wrappers over the VIM Server endpoints this app calls. */
import { apiFetch, path } from './http'
import type {
  DownloadUrl,
  OrgSummary,
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

export function listOrgs(): Promise<OrgSummary[]> {
  return apiFetch<OrgSummary[]>('/org')
}

export function listProjects(orgId: string): Promise<ProjectSummary[]> {
  return apiFetch<ProjectSummary[]>(`/${path('org', orgId, 'project')}`)
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
  return apiFetch<ProjectDetail>(`/${path('project', projectId)}`)
}

export function getProjectRole(projectId: string): Promise<ProjectRole> {
  return apiFetch<ProjectRole>(`/${path('project', projectId, 'role')}`)
}

export function getVimHistory(projectId: string): Promise<VimHistory> {
  return apiFetch<VimHistory>(`/${path('project', projectId, 'vim')}`)
}

/**
 * Resolves the snapshot download URL. The viewer needs the URL itself to issue
 * Range requests, so ask for it as JSON instead of following a 302.
 * Omit `blobId` for the latest snapshot.
 */
export function getVimDownloadUrl(projectId: string, blobId?: string): Promise<DownloadUrl> {
  const query = new URLSearchParams({ redirect: 'false' })
  if (blobId) query.set('blobId', blobId)
  return apiFetch<DownloadUrl>(
    `/${path('project', projectId, 'vim', 'download')}?${query.toString()}`,
  )
}
