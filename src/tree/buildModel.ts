/**
 * Flattens a loaded VIM into the one list the rest of the app works with.
 *
 * The tree, the label panel and the color map all need the same handful of
 * fields per element, so they are read once per loaded snapshot with bulk
 * (columnar) BIM calls instead of one round trip per element.
 */
import type * as VIM from 'vim-web'

type IWebglVim = VIM.Core.Webgl.IWebglVim

export type ModelElement = {
  /** Row index in the VIM element table. The only handle the viewer accepts. */
  index: number
  /** Revit ElementId as text (it is a bigint in the viewer). */
  elementId: string
  /** Revit UniqueId; stable across snapshots, so it is the label store key. */
  uniqueId?: string
  name?: string
  category?: string
  family?: string
}

/**
 * Only elements with geometry are included: those are the ones a user can click
 * in the 3D view, so they are the ones worth listing and coloring.
 *
 * Every BIM table is optional in a VIM file. A file without them still yields a
 * usable list — just without names, categories or families.
 */
export async function buildModel(vim: IWebglVim): Promise<ModelElement[]> {
  const withGeometry = vim.getAllElements().filter((element) => element.hasGeometry)
  const document = vim.bim

  if (!document?.element) {
    return withGeometry.map((element) => ({
      index: element.element,
      elementId: String(element.elementId),
      uniqueId: element.elementUniqueId || undefined,
    }))
  }

  const [elements, categories] = await Promise.all([
    document.element.getAll(),
    document.category?.getAll() ?? Promise.resolve([]),
  ])
  const bimByIndex = new Map(elements.map((element) => [element.index, element]))
  const categoryNameByIndex = new Map(categories.map((category) => [category.index, category.name]))

  return withGeometry.map((element) => {
    const bim = bimByIndex.get(element.element)
    const categoryIndex = bim?.categoryIndex
    return {
      index: element.element,
      elementId: String(bim?.id ?? element.elementId),
      // `||`: vim-web reports a missing UniqueId as an empty string.
      uniqueId: bim?.uniqueId || element.elementUniqueId || undefined,
      name: bim?.name,
      category: categoryIndex === undefined ? undefined : categoryNameByIndex.get(categoryIndex),
      family: bim?.familyName,
    }
  })
}
