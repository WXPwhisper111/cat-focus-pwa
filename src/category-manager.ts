import { ArchivedCategoryError, sortCategories, type FocusCategory } from './categories';
import { addCategory, selectCategory, setCategoryArchived } from './storage';

export function createCategoryManager(db: IDBDatabase, onChange: (message: string) => Promise<void>) {
  const dialog = document.createElement('dialog');
  dialog.className = 'category-dialog';
  dialog.setAttribute('aria-labelledby', 'category-dialog-title');
  dialog.innerHTML = `<div class="panel-head"><h2 id="category-dialog-title">管理专注类别</h2><button type="button" class="dialog-close" aria-label="关闭类别管理">×</button></div>
    <p class="hint">停用后不再用于新专注，历史记录仍会保留。</p>
    <form class="category-add"><label for="category-name">新类别名称</label><div class="category-add-row"><input id="category-name" autocomplete="off" placeholder="例如：阅读" aria-describedby="category-name-hint" /><button class="primary" type="submit">添加</button></div><small id="category-name-hint">1–20 个字符，名称不能重复</small></form>
    <div class="category-error" role="status" aria-live="polite"></div><ul class="category-list" aria-label="已有专注类别"></ul>`;
  document.body.append(dialog);
  const form = dialog.querySelector<HTMLFormElement>('form')!;
  const input = dialog.querySelector<HTMLInputElement>('input')!;
  const list = dialog.querySelector<HTMLUListElement>('ul')!;
  const errorBox = dialog.querySelector<HTMLDivElement>('.category-error')!;
  let categories: FocusCategory[] = [];
  let busy = false;

  function showError(message: string) { errorBox.textContent = message; }
  async function run(task: () => Promise<void>) {
    if (busy) return;
    busy = true;
    showError('');
    update(categories);
    input.disabled = true;
    form.querySelector('button')!.disabled = true;
    try { await task(); }
    catch (error) {
      showError((error as Error).message);
      if (error instanceof ArchivedCategoryError) {
        const restore = document.createElement('button');
        restore.type = 'button';
        restore.textContent = '恢复并选中';
        restore.onclick = () => void run(async () => {
          await setCategoryArchived(db, error.category.id, false);
          await selectCategory(db, error.category.id);
          await onChange(`已恢复并选中“${error.category.name}”。`);
          dialog.close();
        });
        errorBox.append(restore);
      }
    } finally {
      busy = false;
      input.disabled = false;
      form.querySelector('button')!.disabled = false;
      update(categories);
    }
  }
  function update(items: FocusCategory[]) {
    categories = sortCategories(items);
    const enabledCount = categories.filter(item => !item.archived).length;
    list.replaceChildren(...categories.map(category => {
      const row = document.createElement('li');
      const label = document.createElement('span');
      label.className = 'category-name';
      label.textContent = category.name;
      if (category.archived) {
        const badge = document.createElement('small'); badge.textContent = '已停用'; label.append(badge);
      }
      const action = document.createElement('button');
      action.type = 'button';
      action.textContent = category.archived ? '恢复' : '停用';
      action.setAttribute('aria-label', `${action.textContent}${category.name}`);
      action.disabled = busy || (!category.archived && enabledCount === 1);
      if (!category.archived && enabledCount === 1) action.title = '至少需要保留一个可用类别';
      action.onclick = () => void run(async () => {
        await setCategoryArchived(db, category.id, !category.archived);
        await onChange(`已${category.archived ? '恢复' : '停用'}“${category.name}”。`);
      });
      row.append(label, action);
      return row;
    }));
  }
  form.onsubmit = event => {
    event.preventDefault();
    void run(async () => {
      const added = await addCategory(db, input.value);
      input.value = '';
      await onChange(`已添加并选中“${added.name}”。`);
      dialog.close();
    });
  };
  dialog.querySelector<HTMLButtonElement>('.dialog-close')!.onclick = () => dialog.close();
  dialog.addEventListener('close', () => document.querySelector<HTMLButtonElement>('#manage-categories')?.focus());
  return {
    update,
    open() { showError(''); input.value = ''; if (!dialog.open) dialog.showModal(); input.focus(); },
    destroy() { dialog.remove(); },
  };
}
