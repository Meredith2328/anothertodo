"""Small, UI-independent task mutations shared by CLI and TUI."""
from __future__ import annotations

from .model import Task
from .parse import Parsed


def apply_parsed_update(task: Task, parsed: Parsed) -> None:
    """Apply only fields explicitly present in a parsed input line.

    Editing intentionally preserves fields the user did not write. Keeping this
    rule in one place prevents the CLI and TUI from gradually diverging.
    """
    if parsed.title:
        task.title = parsed.title
    if parsed.due is not None:
        task.due = parsed.due
    if parsed.priority:
        task.priority = parsed.priority
    if parsed.tags:
        task.tags = parsed.tags
    if parsed.project is not None:
        task.project = parsed.project
    if parsed.wait is not None:
        task.wait = parsed.wait
    if parsed.reminders:
        task.reminders = [reminder.to_dict() for reminder in parsed.reminders]

