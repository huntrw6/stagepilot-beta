"""Errors raised by the ProPresenter integration boundary."""

from __future__ import annotations


class ProPresenterError(RuntimeError):
    """Base error for a failed ProPresenter operation."""


class ProPresenterConnectionError(ProPresenterError):
    """Raised when the ProPresenter API cannot be reached."""


class ProPresenterResponseError(ProPresenterError):
    """Raised when ProPresenter rejects or returns an invalid response."""


class ProPresenterTimerNotFoundError(ProPresenterError):
    """Raised when the configured timer name cannot be found uniquely."""


class ProPresenterTimerTypeError(ProPresenterError):
    """Raised when the configured timer is not a countdown timer."""
