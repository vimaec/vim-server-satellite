/**
 * English / Japanese, and the number formats the estimate shows.
 *
 * The English text is the key: `t` looks it up in JA when the language is
 * Japanese, and falls back to the English text. Slots are `{name}`.
 *
 * Unlike the original workflow there is no module-level "current language" or
 * "current currency": React state owns those (useEstimate), and `makeT` binds
 * them into the `t` the components get. Everything here is pure.
 */
import type { Basis, Lang } from './types'

/** Strings of the ported features only (no export, project file, filter builder, Parameters view). */
const JA: Record<string, string> = {
  // Panel, tabs, total
  'Estimate': '積算',
  'Elements': '要素',
  'Cost Codes': '単価コード',
  'Markups': '経費率',
  'TOTAL': '合計金額',
  'Direct cost': '直接工事費',
  '{a} of {b} elements have a cost code': '{b} 要素中 {a} 要素に単価コード設定済',
  '{n} without a quantity': '数量なし {n} 件',
  'Markups {pct}%': '経費 {pct}%',
  'Loading the estimate…': '積算を読み込み中…',
  'Could not load the estimate.': '積算を読み込めませんでした。',
  'Could not save the change: {error}': '変更を保存できませんでした：{error}',
  'Retry': '再試行',
  'Read only: your project role is Viewer.': '閲覧のみ：プロジェクトのロールが Viewer です。',
  'Opening the project…': 'プロジェクトを開いています…',
  'Loading the model…': 'モデルを読み込み中…',
  'No VIM in this project yet.': 'このプロジェクトにはまだ VIM がありません。',
  'Reading the model quantities…': 'モデルの数量を読み込み中…',
  'Could not read the model quantities.': 'モデルの数量を読み込めませんでした。',
  'Rename work package': '工種の名前を変更',
  'Frame the shown element': '表示中の要素へカメラを合わせる',
  'Previous': '前へ',
  'Next': '次へ',
  // Cost Details
  'Cost Details': '金額の詳細',
  'Open the cost details panel': '金額の詳細パネルを開く',
  'Close the cost details panel': '金額の詳細パネルを閉じる',
  'Select elements to see their estimate.': '要素を選択すると積算内容が表示されます。',
  'Step through the {n} selected elements': '選択した {n} 個の要素を順に表示',
  'Select more than one element to step between them': '2 つ以上の要素を選択すると順に表示できます',
  '({n} elements)': '（{n} 要素）',
  '{n} elements selected': '{n} 個の要素を選択中',
  'Frame the shown element when stepping (on)': '切り替え時に表示中の要素へカメラを合わせる（オン）',
  'Frame the shown element when stepping (off)': '切り替え時に表示中の要素へカメラを合わせる（オフ）',
  'varies': '混在',
  'Note…': '備考…',
  'varies: typing here replaces every note': '混在：入力するとすべての備考を置き換えます',
  'Summary': '集計',
  'Material ¥': '材料費（円）',
  'Labor ¥': '労務費（円）',
  // Estimation sheets and visibility
  'Estimation sheet': '積算シート',
  'New sheet…': '新しいシート…',
  'New sheet': '新しいシート',
  'Estimate {n}': '積算 {n}',
  'Duplicate…': '複製…',
  'Duplicate': '複製',
  'Rename…': '名前の変更…',
  'Rename': '名前の変更',
  'Delete': '削除',
  'The last sheet cannot be deleted.': '最後のシートは削除できません。',
  'Display': '表示色',
  'No colors': '色分けなし',
  'Costs': '金額',
  'Colors by {level}': '{level}で色分け',
  'Shuffle the colors': '色を入れ替える',
  'White: no cost code. Green → red: element cost by rank, lowest → highest. The lowest quarter of the coded elements is green; half of them cost less than ¥ {mid} (amber).':
    '白：単価コードなし。緑 → 赤：要素の金額の順位（低い → 高い）。単価コードのある要素のうち、安い方から 4 分の 1 は緑で、半数は ¥ {mid} 未満です（黄）。',
  'BIM Document': 'BIM ドキュメント',
  'Set Cost Code…': '単価コードを設定…',
  'Set Work Package…': '工種を設定…',
  'Set Cost Code — {n} elements': '単価コードを設定 — {n} 要素',
  'Set Work Package — {n} elements': '工種を設定 — {n} 要素',
  'Clear cost code': '単価コードを解除',
  'Apply': '適用',
  'New cost code…': '新しい単価コード…',
  '(automatic)': '（自動）',
  'Copy Cost Code': '単価コードをコピー',
  'Paste Cost Code': '単価コードを貼り付け',
  'Select one element to copy its cost code.': '単価コードをコピーする要素を 1 つ選択してください。',
  'This element has no cost code.': 'この要素には単価コードがありません。',
  'Cost code {code} copied.': '単価コード {code} をコピーしました。',
  'Copy a cost code first: select one element and press Ctrl+C.':
    '先に単価コードをコピーしてください：要素を 1 つ選択して Ctrl+C を押します。',
  'Cost code {code} pasted on {n} elements.': '単価コード {code} を {n} 要素に貼り付けました。',
  'Include': '対象にする',
  'Exclude': '対象外にする',
  'Included': '対象',
  'Excluded': '対象外',
  'Show': '表示',
  // Group by
  'Group by': '分類',
  'Element ID': '要素 ID',
  'Configure grouping — add, remove, reorder levels': '分類の設定（追加・削除・並べ替え）',
  'Add a level': '分類を追加',
  'Move up': '上へ移動',
  'Move down': '下へ移動',
  'Remove': '削除',
  'Reset': 'リセット',
  'Expand one more level': '展開',
  'ESTIMATE': '積算',
  'ELEMENT': '要素',
  '(none)': '（なし）',
  'Family': 'ファミリ',
  'Family › Type': 'ファミリ › タイプ',
  'Level': '階',
  'System': '系統',
  'Category': 'カテゴリ',
  'Type': 'タイプ',
  // Elements
  'Search elements, types, codes…': '要素・タイプ・コードを検索…',
  'Expand work packages': '工種を展開',
  'Collapse all': 'すべて折りたたむ',
  '(No work package)': '（工種なし）',
  '(No cost code)': '（単価コードなし）',
  'Name': '名称',
  'Qty': '数量',
  'Amount ¥': '金額（円）',
  'Work package': '工種',
  'Cost code': '単価コード',
  'Extra ¥': '追加費用（円）',
  'Note': '備考',
  'New work package…': '新しい工種…',
  'New work package': '新しい工種',
  'Choose from Cost Codes…': '単価コードから選択…',
  'No element matches the search.': '検索に一致する要素はありません。',
  'No elements.': '要素がありません。',
  'Clear work package and cost code': '工種と単価コードを解除',
  'Delete work package': '工種を削除',
  'Its elements keep their cost codes and lose the work package.': '要素の単価コードは残り、工種は解除されます。',
  'Cancel': 'キャンセル',
  'OK': 'OK',
  '(Clear)': '（解除）',
  '(mixed)': '（混在）',
  // Cost sheet
  'Search codes and names…': 'コード・名称を検索…',
  'All': 'すべて',
  'In use': '使用中',
  'Add code': 'コードを追加',
  'Basis': '計上単位',
  'Unit': '単位',
  'Unit price ¥': '単価（円）',
  'Labor (days/unit)': '歩掛（人工/単位）',
  'Labor rate ¥/day': '労務単価（円/人工）',
  'Material adders %': '材料加算率 %',
  'Labor adders %': '労務加算率 %',
  'Assign to the selected elements': '選択した要素に設定',
  'Currency': '通貨',
  'Delete code': 'コードを削除',
  'Edit…': '編集…',
  'Edit cost code': '単価コードを編集',
  'Save': '保存',
  'Group': '分類',
  'Description': '内容',
  'Discipline': '区分',
  'Enter a code.': 'コードを入力してください。',
  'Another cost code already uses this code.': 'このコードはほかの単価コードで使われています。',
  'Its elements lose this cost code.': '要素からこの単価コードが解除されます。',
  'No cost code matches.': '一致する単価コードはありません。',
  'No cost codes yet. Add a code.': '単価コードがありません。コードを追加してください。',
  'Select elements in the 3D view or the Elements tab first.': '先に 3D ビューまたは「要素」タブで要素を選択してください。',
  'Cost code assigned to {n} elements.': '{n} 要素に単価コードを設定しました。',
  '(No discipline)': '（区分なし）',
  '(No group)': '（分類なし）',
  'Count': '個数',
  'Length': '長さ',
  'Area': '面積',
  'Volume': '体積',
  'Lump sum': '一式',
  // Markups
  'Add markup': '経費を追加',
  'New markup': '新しい経費',
  'Miscellaneous': '雑費',
  'Risk': 'リスク',
  'Safety margin': '安全率',
}

/** Revit's category names in Japanese (Autodesk's own terms) for the common categories. */
const CATEGORY_JA: Record<string, string> = {
  'Pipes': '配管', 'Pipe Fittings': '配管継手', 'Pipe Accessories': '配管付属品', 'Flex Pipes': 'フレキシブル配管',
  'Plumbing Fixtures': '衛生器具', 'Sprinklers': 'スプリンクラー', 'Ducts': 'ダクト', 'Duct Fittings': 'ダクト継手',
  'Duct Accessories': 'ダクト付属品', 'Flex Ducts': 'フレキシブル ダクト', 'Air Terminals': '制気口',
  'Mechanical Equipment': '機械設備', 'Cable Trays': 'ケーブル ラック', 'Cable Tray Fittings': 'ケーブル ラック継手',
  'Conduits': '電線管', 'Conduit Fittings': '電線管継手', 'Electrical Equipment': '電気設備', 'Electrical Fixtures': '電気器具',
  'Lighting Fixtures': '照明器具', 'Communication Devices': '通信装置', 'Generic Models': '一般モデル',
  'Specialty Equipment': '特殊設備', 'Walls': '壁', 'Floors': '床', 'Ceilings': '天井', 'Doors': 'ドア', 'Windows': '窓',
  'Columns': '柱', 'Structural Columns': '構造柱', 'Structural Framing': '構造フレーム', 'Structural Foundations': '構造基礎',
  'Furniture': '家具', 'Furniture Systems': '家具システム', 'Casework': '造作', 'Railings': '手すり', 'Roofs': '屋根',
  'Stairs': '階段', 'Curtain Panels': 'カーテン パネル', 'Curtain Wall Mullions': 'カーテンウォール マリオン',
  'Supports': '支持材', 'Topography': '地形',
}

/**
 * The currencies a sheet can show. Only the symbol changes: switching converts
 * nothing.
 */
export const CURRENCIES: { id: string; symbol: string }[] = [
  { id: 'USD', symbol: '$' }, { id: 'EUR', symbol: '€' }, { id: 'GBP', symbol: '£' }, { id: 'JPY', symbol: '¥' },
  { id: 'CNY', symbol: 'CN¥' }, { id: 'KRW', symbol: '₩' }, { id: 'TWD', symbol: 'NT$' }, { id: 'HKD', symbol: 'HK$' },
  { id: 'SGD', symbol: 'S$' }, { id: 'THB', symbol: '฿' }, { id: 'INR', symbol: '₹' }, { id: 'AUD', symbol: 'A$' },
  { id: 'CAD', symbol: 'CA$' }, { id: 'CHF', symbol: 'CHF' },
]

/** A new sheet's currency, unless it copies another sheet's. */
export const DEFAULT_CURRENCY = 'USD'

/** The symbol of an ISO code; an unknown code reads as the default currency. */
export function currencySymbol(currency: string): string {
  return (CURRENCIES.find((entry) => entry.id === currency) ?? CURRENCIES[0]).symbol
}

/** Slot values for `t`. */
export type Vars = Record<string, string | number>

/** A translator bound to one language and one currency. */
export type Translator = (text: string, vars?: Vars) => string

/**
 * Translates `text` and fills its slots.
 *
 * The labels are written for yen ("Amount ¥", "金額（円）"); for any other
 * currency the yen marks become that currency's symbol. This runs BEFORE the
 * slots are filled, so data put into a slot (a note, a code name) keeps its
 * own text even when it contains ¥ or 円.
 */
export function translate(lang: Lang, currency: string, text: string, vars?: Vars): string {
  let out = lang === 'ja' ? JA[text] ?? text : text
  if (currency !== 'JPY') out = out.replace(/[¥円]/g, currencySymbol(currency))
  if (vars) out = out.replace(/\{(\w+)\}/g, (slot, key: string) => (key in vars ? String(vars[key]) : slot))
  return out
}

/** `t` for one language and currency. */
export function makeT(lang: Lang, currency: string): Translator {
  return (text, vars) => translate(lang, currency, text, vars)
}

/** A Revit category name in the UI language (Revit models carry the English names). */
export function categoryLabel(lang: Lang, name: string): string {
  return lang === 'ja' ? CATEGORY_JA[name] ?? name : name
}

const BASIS_TEXT: Record<Basis, string> = {
  count: 'Count',
  length: 'Length',
  area: 'Area',
  volume: 'Volume',
  lump: 'Lump sum',
}

/** The basis as the selects show it. */
export function basisLabel(t: Translator, basis: Basis | string): string {
  return t(BASIS_TEXT[basis as Basis] ?? 'Count')
}

function isNumber(value: unknown): value is number | string {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
}

/** An amount, rounded, with thousands separators; no symbol (the column label carries it). '' for none. */
export function amount(value: number | string | null | undefined): string {
  return isNumber(value) ? Math.round(Number(value)).toLocaleString('ja-JP') : ''
}

/** A quantity with up to two decimals. '' for none. */
export function qtyText(value: number | string | null | undefined): string {
  return isNumber(value) ? Number(value).toLocaleString('ja-JP', { maximumFractionDigits: 2 }) : ''
}

/** An amount with the currency symbol: "$ 1,234", "¥ 1,234". */
export function money(value: number | string | null | undefined, currency: string): string {
  return `${currencySymbol(currency)} ${amount(value)}`
}

/**
 * A typed number: full-width digits, currency symbols, commas and spaces are
 * allowed, because people type "１，２００円" as readily as "1200". '' → null,
 * and so is anything that is not a number.
 */
export function parseNumber(text: string | number | null | undefined): number | null {
  const cleaned = String(text ?? '')
    .normalize('NFKC')
    .replace(/[\p{Sc}円,\s]/gu, '')
  if (!cleaned) return null
  const number = Number(cleaned)
  return Number.isFinite(number) ? number : null
}
