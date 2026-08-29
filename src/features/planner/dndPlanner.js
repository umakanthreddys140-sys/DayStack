/**
 * DAYSTACK Daily Planner Drag-and-Drop Reordering & Inline Task Editing
 * Provides fluid reordering and fast keyboard-first inline task management.
 */

export class DndPlanner {
  /**
   * Binds drag-and-drop and inline editing controls to task list container.
   * @param {HTMLElement} containerEl The #taskList DOM element
   * @param {object} plan Current day planner object
   * @param {Function} onUpdate Callback when task order/content changes
   */
  static bind(containerEl, plan, onUpdate) {
    if (!containerEl || !plan || !Array.isArray(plan.tasks)) return;

    let draggedItem = null;
    let draggedId = null;

    const items = containerEl.querySelectorAll('[data-task-item]');
    items.forEach(item => {
      // Enable dragging
      item.setAttribute('draggable', 'true');

      item.addEventListener('dragstart', (e) => {
        draggedItem = item;
        draggedId = item.dataset.taskItem;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', draggedId);
        item.classList.add('is-dragging');
      });

      item.addEventListener('dragend', () => {
        if (draggedItem) draggedItem.classList.remove('is-dragging');
        containerEl.querySelectorAll('.is-dragover').forEach(el => el.classList.remove('is-dragover'));
        draggedItem = null;
        draggedId = null;
      });

      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (item !== draggedItem) {
          item.classList.add('is-dragover');
        }
      });

      item.addEventListener('dragleave', () => {
        item.classList.remove('is-dragover');
      });

      item.addEventListener('drop', (e) => {
        e.preventDefault();
        item.classList.remove('is-dragover');
        const targetId = item.dataset.taskItem;
        if (!draggedId || draggedId === targetId) return;

        const fromIdx = plan.tasks.findIndex(t => t.id === draggedId);
        const toIdx = plan.tasks.findIndex(t => t.id === targetId);

        if (fromIdx !== -1 && toIdx !== -1) {
          const [movedTask] = plan.tasks.splice(fromIdx, 1);
          plan.tasks.splice(toIdx, 0, movedTask);
          // Mark custom order
          plan.tasks.forEach((t, idx) => { t.order = idx; });
          if (typeof onUpdate === 'function') onUpdate(plan);
        }
      });
    });

    // Inline task title editing and Enter/Backspace keyboard workflows
    containerEl.querySelectorAll('.task-inline-edit').forEach(input => {
      const taskId = input.dataset.inlineTaskId;
      const task = plan.tasks.find(t => t.id === taskId);
      if (!task) return;

      input.addEventListener('change', () => {
        const val = input.value.trim();
        if (val) {
          task.text = val;
          if (typeof onUpdate === 'function') onUpdate(plan, false);
        }
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          // Create new task directly after current task
          const curIdx = plan.tasks.findIndex(t => t.id === taskId);
          const newTask = {
            id: 'tk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            text: '',
            time: '',
            priority: 'medium',
            done: false,
            notes: '',
            order: (task.order || curIdx) + 1
          };
          plan.tasks.splice(curIdx + 1, 0, newTask);
          if (typeof onUpdate === 'function') onUpdate(plan, true, newTask.id);
        } else if (e.key === 'Backspace' && input.value === '') {
          // Remove empty task on backspace
          e.preventDefault();
          const curIdx = plan.tasks.findIndex(t => t.id === taskId);
          if (plan.tasks.length > 1 && curIdx !== -1) {
            plan.tasks.splice(curIdx, 1);
            const prevTask = plan.tasks[Math.max(0, curIdx - 1)];
            if (typeof onUpdate === 'function') onUpdate(plan, true, prevTask ? prevTask.id : null);
          }
        }
      });
    });
  }
}

if (typeof window !== 'undefined') {
  window.DndPlanner = DndPlanner;
}
