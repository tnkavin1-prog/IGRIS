"""Typed error hierarchy.

Every failure raised inside IGRIS carries a machine-readable ``code`` and a
``retryable`` flag so the executor can classify errors and decide between
retry, replan and abort without string matching.
"""
from __future__ import annotations


class ErrorCode:
    CONFIG_MISSING = "CONFIG_MISSING"
    AUTH_REQUIRED = "AUTH_REQUIRED"
    PERMISSION_DENIED = "PERMISSION_DENIED"
    POLICY_BLOCKED = "POLICY_BLOCKED"
    PATH_OUTSIDE_SCOPE = "PATH_OUTSIDE_SCOPE"
    VALIDATION = "VALIDATION"
    TOOL_NOT_FOUND = "TOOL_NOT_FOUND"
    TOOL_FAILED = "TOOL_FAILED"
    TIMEOUT = "TIMEOUT"
    RATE_LIMITED = "RATE_LIMITED"
    PROVIDER_ERROR = "PROVIDER_ERROR"
    PROVIDER_UNAUTHORIZED = "PROVIDER_UNAUTHORIZED"
    MODEL_UNAVAILABLE = "MODEL_UNAVAILABLE"
    NETWORK = "NETWORK"
    RESOURCE_MISSING = "RESOURCE_MISSING"
    VERIFICATION_FAILED = "VERIFICATION_FAILED"
    INTERRUPTED = "INTERRUPTED"
    UNSUPPORTED_PLATFORM = "UNSUPPORTED_PLATFORM"
    INTERNAL = "INTERNAL"


RETRYABLE_CODES = {
    ErrorCode.TIMEOUT,
    ErrorCode.RATE_LIMITED,
    ErrorCode.NETWORK,
    ErrorCode.PROVIDER_ERROR,
}


class IgrisError(Exception):
    code = ErrorCode.INTERNAL
    retryable = False
    #: HTTP-ish status used when surfacing the error over the local API.
    status = 500

    def __init__(self, message: str, *, details: dict | None = None,
                 retryable: bool | None = None, cause: BaseException | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}
        if retryable is not None:
            self.retryable = retryable
        if cause is not None:
            self.__cause__ = cause

    def to_dict(self) -> dict:
        return {
            "code": self.code,
            "message": self.message,
            "details": self.details,
            "retryable": self.retryable,
        }


class ConfigError(IgrisError):
    code = ErrorCode.CONFIG_MISSING
    status = 409


class AuthorizationRequired(IgrisError):
    """Raised when an action needs an explicit user authorization grant."""
    code = ErrorCode.AUTH_REQUIRED
    status = 403


class PermissionDenied(IgrisError):
    code = ErrorCode.PERMISSION_DENIED
    status = 403


class PolicyBlocked(IgrisError):
    code = ErrorCode.POLICY_BLOCKED
    status = 403


class PathOutsideScope(IgrisError):
    code = ErrorCode.PATH_OUTSIDE_SCOPE
    status = 403


class ValidationError(IgrisError):
    code = ErrorCode.VALIDATION
    status = 422


class ToolNotFound(IgrisError):
    code = ErrorCode.TOOL_NOT_FOUND
    status = 404


class ToolError(IgrisError):
    code = ErrorCode.TOOL_FAILED


class ToolTimeout(IgrisError):
    code = ErrorCode.TIMEOUT
    retryable = True


class RateLimited(IgrisError):
    code = ErrorCode.RATE_LIMITED
    retryable = True
    status = 429


class ProviderError(IgrisError):
    code = ErrorCode.PROVIDER_ERROR
    retryable = True
    status = 502


class ProviderUnauthorized(IgrisError):
    code = ErrorCode.PROVIDER_UNAUTHORIZED
    status = 401


class ModelUnavailable(IgrisError):
    code = ErrorCode.MODEL_UNAVAILABLE
    status = 404


class NetworkError(IgrisError):
    code = ErrorCode.NETWORK
    retryable = True
    status = 502


class ResourceMissing(IgrisError):
    code = ErrorCode.RESOURCE_MISSING
    status = 404


class VerificationFailed(IgrisError):
    code = ErrorCode.VERIFICATION_FAILED


class Interrupted(IgrisError):
    code = ErrorCode.INTERRUPTED
    status = 499


class UnsupportedPlatform(IgrisError):
    code = ErrorCode.UNSUPPORTED_PLATFORM
    status = 501
