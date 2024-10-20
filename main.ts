import { App, MarkdownView, Modal, Plugin, TFile } from "obsidian";

interface Task {
	text: string;
	completed: boolean;
	filePath: string;
	lineNumber: number;
}

class TaskSearchModal extends Modal {
	private input: HTMLInputElement;
	private completedTasksCheckbox: HTMLInputElement;
	private resultsContainer: HTMLElement;
	private taskCountLabel: HTMLElement;
	private selectedTaskIndex: number = -1;
	private tasks: Task[] = [];
	private filteredTasks: Task[] = [];
	private debounceTimer: NodeJS.Timeout | null = null;

	constructor(public app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl, modalEl } = this;
		modalEl.querySelector(".modal-close-button")?.remove();
		modalEl.addClass("task-search-modal");

		this.createSearchContainer(contentEl);
		this.createResultsContainer(contentEl);

		this.getTasks().then(() => {
			this.input.focus();
		});
	}

	onClose() {
		this.contentEl.empty();
	}

	private createSearchContainer(contentEl: HTMLElement) {
		const searchContainer = contentEl.createEl("div", {
			cls: "search-container",
		});

		this.completedTasksCheckbox =
			this.createCompletedTasksCheckbox(searchContainer);
		this.input = this.createSearchInput(searchContainer);
		this.taskCountLabel = searchContainer.createEl("div", {
			cls: "task-count-label",
			text: "0 tasks",
		});
	}

	private createCompletedTasksCheckbox(
		container: HTMLElement
	): HTMLInputElement {
		const checkbox = container.createEl("input", {
			type: "checkbox",
			cls: "completed-tasks-checkbox",
		});
		checkbox.id = "completed-tasks-checkbox";
		checkbox.addEventListener("change", () => this.debouncedSearch());

		const label = container.createEl("label");
		label.htmlFor = checkbox.id;

		return checkbox;
	}

	private createSearchInput(container: HTMLElement): HTMLInputElement {
		const input = container.createEl("input", {
			type: "text",
			placeholder: "Enter text to search...",
			cls: "full-width-input",
		});

		input.addEventListener("input", () => this.debouncedSearch());
		input.addEventListener("keydown", (event) => this.handleKeyDown(event));

		return input;
	}

	private createResultsContainer(contentEl: HTMLElement) {
		this.resultsContainer = contentEl.createEl("div");
	}

	private debouncedSearch() {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}
		this.debounceTimer = setTimeout(() => this.searchTasks(), 300);
	}

	private async searchTasks() {
		const query = this.input.value.toLowerCase();
		const showCompleted = this.completedTasksCheckbox.checked;

		if (query.trim() === "") {
			this.resetSearch();
			return;
		}

		this.filteredTasks = this.tasks.filter((task) => {
			const matchesText = task.text.toLowerCase().includes(query);
			const matchesCompletionStatus = showCompleted
				? task.completed
				: !task.completed;
			return matchesText && matchesCompletionStatus;
		});

		this.renderResults();
		this.taskCountLabel.setText(`${this.filteredTasks.length} tasks`);
		this.selectedTaskIndex = this.filteredTasks.length > 0 ? 0 : -1;
		this.highlightSelectedTask();
	}

	private resetSearch() {
		this.resultsContainer.empty();
		this.taskCountLabel.setText("0 tasks");
		this.selectedTaskIndex = -1;
		this.filteredTasks = [];
	}

	private renderResults() {
		this.resultsContainer.empty();
		const fragment = document.createDocumentFragment();

		this.filteredTasks.forEach((task, index) => {
			const taskElement = this.createTaskElement(task, index);
			fragment.appendChild(taskElement);
		});

		this.resultsContainer.appendChild(fragment);
	}

	private createTaskElement(task: Task, index: number): HTMLElement {
		const taskElement = document.createElement("div");
		taskElement.className = "task-item";

		const taskText = this.createTaskText(task);
		const checkbox = this.createTaskCheckbox(task);

		taskElement.appendChild(checkbox);
		taskElement.appendChild(taskText);

		taskElement.addEventListener("click", (event) => {
			if ((event.target as HTMLElement).className !== "task-checkbox") {
				this.selectedTaskIndex = index;
				this.openSelectedTask();
			}
		});

		return taskElement;
	}

	private createTaskText(task: Task): HTMLElement {
		const taskText = document.createElement("span");
		taskText.className = task.completed ? "task-completed" : "task-text";
		taskText.innerHTML = this.formatTaskText(task.text);
		return taskText;
	}

	private createTaskCheckbox(task: Task): HTMLInputElement {
		const checkbox = document.createElement("input");
		checkbox.type = "checkbox";
		checkbox.className = "task-checkbox";
		checkbox.checked = task.completed;

		checkbox.addEventListener("change", (event) =>
			this.handleTaskCompletion(event, task)
		);

		return checkbox;
	}

	private formatTaskText(text: string): string {
		return text
			.replace(/#\S+/g, "")
			.replace(
				/\[([^\]]+)\]\(([^)]+)\)/g,
				"🌐 <span class='link'> $1 </span>"
			)
			.replace(
				/\[\[([^\|]+)\|([^\]]+)\]\]/g,
				"🔗 <span class='link'> $2 </span>"
			)
			.replace(/\[\[([^\]]+)\]\]/g, "🔗 <span class='link'> $1 </span>")
			.trim();
	}

	private async handleTaskCompletion(event: Event, task: Task) {
		event.stopPropagation();
		const checkbox = event.target as HTMLInputElement;
		task.completed = checkbox.checked;

		const file = this.app.vault.getAbstractFileByPath(task.filePath);
		if (file instanceof TFile) {
			const content = await this.app.vault.read(file);
			const updatedContent = this.updateTaskInContent(content, task);
			await this.app.vault.modify(file, updatedContent);
		}

		const taskText = checkbox.nextElementSibling as HTMLElement;
		taskText.className = task.completed ? "task-completed" : "task-text";

		this.renderResults();
	}

	private updateTaskInContent(content: string, task: Task): string {
		const lines = content.split("\n");
		lines[task.lineNumber - 1] = task.completed
			? lines[task.lineNumber - 1].replace(/^\s*-\s*\[ \]/, "- [x]")
			: lines[task.lineNumber - 1].replace(/^\s*-\s*\[x\]/, "- [ ]");
		return lines.join("\n");
	}

	// ... existing code ...

	private async getTasks(): Promise<void> {
		this.tasks = [];
		const files = this.app.vault.getMarkdownFiles();

		for (const file of files) {
			const tasks = await this.getTasksFromFile(file);
			this.tasks.push(...tasks);
		}
	}

	private async getTasksFromFile(file: TFile): Promise<Task[]> {
		const tasks: Task[] = [];
		const content = await this.app.vault.cachedRead(file);
		const lines = content.split("\n");

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const isCompleted = line.startsWith("- [x]");
			const isTask = line.startsWith("- [ ]") || isCompleted;

			if (isTask) {
				tasks.push({
					text: line.replace(/^\s*-\s*\[x\]|\s*-\s*\[ \]/, "").trim(),
					completed: isCompleted,
					filePath: file.path,
					lineNumber: i + 1,
				});
			}
		}

		return tasks;
	}

	private handleKeyDown(event: KeyboardEvent) {
		switch (true) {
			case event.ctrlKey && (event.key === "l" || event.code === "KeyL"):
				event.preventDefault();
				this.toggleCompletedTasks();
				break;
			case event.key === "ArrowDown" ||
				(event.ctrlKey && event.code === "KeyJ"):
				event.preventDefault();
				this.selectNextTask();
				break;
			case event.key === "ArrowUp" ||
				(event.ctrlKey && event.code === "KeyK"):
				event.preventDefault();
				this.selectPreviousTask();
				break;
			case event.key === "Enter":
				event.preventDefault();
				event.stopPropagation();
				this.openSelectedTask();
				break;
		}
	}

	private toggleCompletedTasks() {
		this.completedTasksCheckbox.checked =
			!this.completedTasksCheckbox.checked;
		this.debouncedSearch();
	}

	private selectNextTask() {
		if (this.filteredTasks.length === 0) return;
		this.selectedTaskIndex =
			(this.selectedTaskIndex + 1) % this.filteredTasks.length;
		this.highlightSelectedTask();
	}

	private selectPreviousTask() {
		if (this.filteredTasks.length === 0) return;
		this.selectedTaskIndex =
			(this.selectedTaskIndex - 1 + this.filteredTasks.length) %
			this.filteredTasks.length;
		this.highlightSelectedTask();
	}

	private highlightSelectedTask() {
		const taskItems = this.resultsContainer.querySelectorAll(".task-item");
		taskItems.forEach((item, index) => {
			item.toggleClass("selected", index === this.selectedTaskIndex);
		});
	}

	private async openSelectedTask() {
		if (
			this.selectedTaskIndex >= 0 &&
			this.selectedTaskIndex < this.filteredTasks.length
		) {
			const task = this.filteredTasks[this.selectedTaskIndex];
			const file = this.app.vault.getAbstractFileByPath(task.filePath);
			if (file instanceof TFile) {
				await this.app.workspace.openLinkText(
					file.path,
					file.path,
					false
				);
				this.close();

				this.focusOnTask(task);
			} else {
				console.error("File not found:", task.filePath);
			}
		}
	}

	private focusOnTask(task: Task) {
		setTimeout(() => {
			const editor =
				this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
			if (editor) {
				editor.setCursor({
					line: task.lineNumber - 1,
					ch: task.text.length,
				});
				editor.focus();
			}
		}, 100);
	}
}

export default class TaskSearchPlugin extends Plugin {
	onload() {
		this.addCommand({
			id: "open-task-search-modal",
			name: "Open Task Search Modal",
			callback: () => {
				new TaskSearchModal(this.app).open();
			},
		});
	}
}
