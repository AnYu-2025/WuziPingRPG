import { deriveEdit } from './reducer.js';
import type { Op, PhotoDocument } from './types.js';

export interface PushOptions {
  /**
   * 与栈顶同类操作合并。
   *
   * 用于连续交互（拖动滑杆、连续拉曲线）：若每次都 push，一次拖拽会
   * 产生几十条历史，用户按一次撤销只回退一像素。开着 merge 时，
   * 连续的同类操作只保留最后一次，一次拖拽 = 一步撤销。
   */
  readonly merge?: boolean;
}

/**
 * 追加一个操作。
 *
 * 会把 cursor 之后的重做分支丢弃 —— 这是标准编辑器语义：
 * 撤销几步后产生新操作，原来的"未来"就不存在了。
 */
export function pushOp(
  doc: PhotoDocument,
  op: Op,
  options: PushOptions = {},
): PhotoDocument {
  const ops = doc.ops;
  const cursor = Math.max(0, Math.min(doc.cursor, ops.length));
  const top = cursor > 0 ? ops[cursor - 1] : undefined;
  const canMerge = options.merge === true && top !== undefined && top.k === op.k;

  if (canMerge) {
    // 替换栈顶：长度不变，cursor 不动
    const next = ops.slice();
    next[cursor - 1] = op;
    return { ...doc, ops: next, cursor };
  }

  const next = [...ops.slice(0, cursor), op];
  return { ...doc, ops: next, cursor: cursor + 1 };
}

/** 撤销一步（移动指针，不丢数据）。 */
export function undo(doc: PhotoDocument): PhotoDocument {
  return doc.cursor > 0 ? { ...doc, cursor: doc.cursor - 1 } : doc;
}

/** 重做一步。 */
export function redo(doc: PhotoDocument): PhotoDocument {
  return doc.cursor < doc.ops.length ? { ...doc, cursor: doc.cursor + 1 } : doc;
}

export function canUndo(doc: PhotoDocument): boolean {
  return doc.cursor > 0;
}

export function canRedo(doc: PhotoDocument): boolean {
  return doc.cursor < doc.ops.length;
}

/** 跳到任意历史位置（时间旅行）。 */
export function jumpTo(doc: PhotoDocument, cursor: number): PhotoDocument {
  const c = Math.max(0, Math.min(cursor, doc.ops.length));
  return c === doc.cursor ? doc : { ...doc, cursor: c };
}

/**
 * 压平历史：把当前编辑状态固化为新基线，清空操作栈。
 *
 * 用于"另存为工程"或加载工程后丢弃历史。注意它同样会丢弃重做分支。
 */
export function squash(doc: PhotoDocument): PhotoDocument {
  return { ...doc, baseline: deriveEdit(doc), ops: [], cursor: 0 };
}

/** 生效中的操作条数。 */
export function historyLength(doc: PhotoDocument): number {
  return doc.cursor;
}

/** 栈顶操作（不含重做分支）。 */
export function lastOp(doc: PhotoDocument): Op | null {
  return doc.cursor > 0 ? doc.ops[doc.cursor - 1] : null;
}
