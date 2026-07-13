"""Typed Planning Center JSON:API transport and domain models."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class PlanningCenterServiceType(BaseModel):
    """Service type information safe to expose to setup and selection interfaces."""

    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    sequence: int = Field(ge=0)
    archived: bool = False


class ServiceTypeAttributes(BaseModel):
    """Subset of ServiceType attributes used by StagePilot."""

    name: str = Field(min_length=1)
    sequence: int = Field(default=0, ge=0)
    archived_at: datetime | None = None
    deleted_at: datetime | None = None


class ServiceTypeResource(BaseModel):
    type: Literal["ServiceType"]
    id: str = Field(min_length=1)
    attributes: ServiceTypeAttributes


class NextPage(BaseModel):
    offset: int = Field(ge=0)


class PaginationMeta(BaseModel):
    total_count: int | None = Field(default=None, ge=0)
    count: int | None = Field(default=None, ge=0)
    next: NextPage | None = None


class CollectionLinks(BaseModel):
    self: str | None = None
    next: str | None = None


class CollectionDocument[ResourceT](BaseModel):
    """JSON:API collection envelope with Planning Center pagination metadata."""

    data: list[ResourceT]
    meta: PaginationMeta = Field(default_factory=PaginationMeta)
    links: CollectionLinks = Field(default_factory=CollectionLinks)
