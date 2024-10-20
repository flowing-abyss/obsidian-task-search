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
	public app: App;

	onOpen() {
		const { contentEl, modalEl } = this;
		modalEl.querySelector(".modal-close-button")?.remove();
		modalEl.addClass("task-search-modal");

		const searchContainer = contentEl.createEl("div", {
			cls: "search-container",
		});

		this.completedTasksCheckbox = searchContainer.createEl("input", {
			type: "checkbox",
			cls: "completed-tasks-checkbox",
		});
		this.completedTasksCheckbox.setAttribute(
			"id",
			"completed-tasks-checkbox"
		);
		this.completedTasksCheckbox.addEventListener("change", () =>
			this.searchTasks()
		);

		const checkboxLabel = searchContainer.createEl("label");
		checkboxLabel.htmlFor = this.completedTasksCheckbox.id;

		this.input = searchContainer.createEl("input", {
			type: "text",
			placeholder: "Enter text to search...",
			cls: "full-width-input",
		});
		this.input.addEventListener("input", () => this.searchTasks());

		this.input.addEventListener("keydown", (event) => {
			if (event.ctrlKey && (event.key === "l" || event.code === "KeyL")) {
				event.preventDefault();
				this.completedTasksCheckbox.checked =
					!this.completedTasksCheckbox.checked;
				this.searchTasks();
			} else if (
				event.key === "ArrowDown" ||
				(event.ctrlKey && event.code === "KeyJ")
			) {
				event.preventDefault();
				this.selectNextTask();
			} else if (
				event.key === "ArrowUp" ||
				(event.ctrlKey && event.code === "KeyK")
			) {
				event.preventDefault();
				this.selectPreviousTask();
			} else if (event.key === "Enter") {
				event.preventDefault();
				event.stopPropagation();
				this.openSelectedTask();
			}
		});

		this.taskCountLabel = searchContainer.createEl("div", {
			cls: "task-count-label",
			text: "0 tasks",
		});

		this.resultsContainer = contentEl.createEl("div");

		setTimeout(() => this.input.focus(), 0);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}

	private async searchTasks() {
		const query = this.input.value.toLowerCase();
		const includeCompleted = this.completedTasksCheckbox.checked;

		if (query.trim() === "") {
			this.resultsContainer.empty();
			this.taskCountLabel.setText("0 tasks");
			this.selectedTaskIndex = -1;
			this.filteredTasks = [];
			return;
		}

		this.tasks = await this.getTasks();
		this.filteredTasks = this.tasks.filter((task) => {
			const matchesText = task.text.toLowerCase().includes(query);
			const matchesCompleted = includeCompleted
				? task.completed
				: !task.completed;
			return matchesText && matchesCompleted;
		});

		this.renderResults(this.filteredTasks);
		this.taskCountLabel.setText(`${this.filteredTasks.length} tasks`);
		this.selectedTaskIndex = this.filteredTasks.length > 0 ? 0 : -1;
		this.highlightSelectedTask();
	}

	private renderResults(tasks: Task[]) {
		this.resultsContainer.empty();
		tasks.forEach((task, index) => {
			const taskElement = this.resultsContainer.createEl("div", {
				cls: "task-item",
			});

			const taskTextWithoutTags = task.text
				.replace(/#\S+/g, "")
				.replace(
					/\[([^\]]+)\]\(([^)]+)\)/g,
					"🌐 <span class='link'> $1 </span>"
				)
				.replace(
					/\[\[([^\|]+)\|([^\]]+)\]\]/g,
					"🔗 <span class='link'> $2 </span>"
				)
				.replace(
					/\[\[([^\]]+)\]\]/g,
					"🔗 <span class='link'> $1 </span>"
				);

			const taskText = taskElement.createEl("span", {
				cls: task.completed ? "task-completed" : "task-text",
			});
			taskText.innerHTML = taskTextWithoutTags.trim();

			const checkbox = taskElement.createEl("input", {
				type: "checkbox",
				cls: "task-checkbox",
			});
			checkbox.checked = task.completed;

			checkbox.addEventListener("change", async (event) => {
				event.stopPropagation();
				task.completed = checkbox.checked;

				const file = this.app.vault.getAbstractFileByPath(
					task.filePath
				);
				if (file instanceof TFile) {
					const content = await this.app.vault.read(file);
					const updatedContent = content
						.split("\n")
						.map((line, index) => {
							if (index === task.lineNumber - 1) {
								return task.completed
									? line.replace(/^\s*-\s*\[ \]/, "- [x]")
									: line.replace(/^\s*-\s*\[x\]/, "- [ ]");
							}
							return line;
						})
						.join("\n");

					await this.app.vault.modify(file, updatedContent);
				}

				taskText.innerHTML = taskTextWithoutTags.trim();
				taskText.toggleClass("task-completed", task.completed);
			});

			taskElement.addEventListener("click", async () => {
				this.selectedTaskIndex = index;
				this.openSelectedTask();
			});

			taskElement.prepend(checkbox);
		});
	}

	private highlightSelectedTask() {
		const taskItems = this.resultsContainer.querySelectorAll(".task-item");
		taskItems.forEach((item, index) => {
			item.toggleClass("selected", index === this.selectedTaskIndex);
		});
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

				setTimeout(() => {
					const editor =
						this.app.workspace.getActiveViewOfType(
							MarkdownView
						)?.editor;
					if (editor) {
						editor.setCursor({
							line: task.lineNumber - 1,
							ch: task.text.length,
						});
						editor.focus();
					}
				}, 100);
			} else {
				console.error("File not found:", task.filePath);
			}
		}
	}

	private async getTasks(): Promise<Task[]> {
		const tasks: Task[] = [];
		const files = this.app.vault.getMarkdownFiles();

		for (const file of files) {
			const content = await this.app.vault.read(file);
			const lines = content.split("\n");

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const isCompleted = line.startsWith("- [x]");
				const isTask = line.startsWith("- [ ]") || isCompleted;

				if (isTask) {
					tasks.push({
						text: line
							.replace(/^\s*-\s*\[x\]|\s*-\s*\[ \]/, "")
							.trim(),
						completed: isCompleted,
						filePath: file.path,
						lineNumber: i + 1,
					});
				}
			}
		}

		return tasks;
	}
}

export default class MyPlugin extends Plugin {
	onload() {
		this.addCommand({
			id: "open-task-search-modal",
			name: "Open Task Search Modal",
			callback: () => {
				const modal = new TaskSearchModal(this.app);
				modal.open();
			},
		});
	}
}
