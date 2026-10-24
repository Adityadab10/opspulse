import pytest
import requests
from fastapi.testclient import TestClient

import app
import rag_service


client = TestClient(app.app)


def test_analyst_requires_internal_authorization(monkeypatch):
    monkeypatch.setenv("ML_ANALYST_INTERNAL_TOKEN", "test-internal-token")
    response = client.post("/ai-analyst", json={"question": "How many products exist?"})
    assert response.status_code == 401
    assert response.json() == {"error": "Invalid internal authorization"}


def test_analyst_rejects_malformed_internal_authorization(monkeypatch):
    monkeypatch.setenv("ML_ANALYST_INTERNAL_TOKEN", "test-internal-token")
    response = client.post(
        "/ai-analyst",
        headers={"Authorization": "Bearer arbitrary-token"},
        json={"question": "How many products exist?"},
    )
    assert response.status_code == 401
    assert response.json() == {"error": "Invalid internal authorization"}


def test_analyst_fails_closed_without_internal_configuration(monkeypatch):
    monkeypatch.delenv("ML_ANALYST_INTERNAL_TOKEN", raising=False)
    response = client.post(
        "/ai-analyst",
        headers={"X-ML-Internal-Token": "test-internal-token"},
        json={"question": "How many products exist?"},
    )
    assert response.status_code == 503
    assert response.json() == {"error": "AI Analyst authorization is not configured"}


def test_analyst_rejects_empty_question(monkeypatch):
    monkeypatch.setenv("ML_ANALYST_INTERNAL_TOKEN", "test-internal-token")
    response = client.post(
        "/ai-analyst",
        headers={"X-ML-Internal-Token": "test-internal-token"},
        json={"question": "   "},
    )
    assert response.status_code == 400
    assert response.json() == {"error": "question is required"}


def test_analyst_authorized_request_returns_grounded_response(monkeypatch):
    monkeypatch.setenv("ML_ANALYST_INTERNAL_TOKEN", "test-internal-token")
    monkeypatch.setattr(
        app,
        "answer_question",
        lambda question: {
            "answer": "There are 20 products.",
            "category": "live_business_analytics",
            "sources": [{"type": "live_database", "label": "PostgreSQL analytics"}],
            "provenance": {"liveData": True, "documentation": False},
        },
    )

    response = client.post(
        "/ai-analyst",
        headers={"X-ML-Internal-Token": "test-internal-token"},
        json={"question": "How many products exist?"},
    )

    assert response.status_code == 200
    assert response.json()["provenance"]["liveData"] is True


def test_analyst_returns_sanitized_retrieval_failure(monkeypatch):
    monkeypatch.setenv("ML_ANALYST_INTERNAL_TOKEN", "test-internal-token")
    monkeypatch.setattr(
        app,
        "answer_question",
        lambda _: (_ for _ in ()).throw(RuntimeError("database password leaked")),
    )

    response = client.post(
        "/ai-analyst",
        headers={"X-ML-Internal-Token": "test-internal-token"},
        json={"question": "How many products exist?"},
    )

    assert response.status_code == 500
    assert response.json() == {"error": "AI Analyst failed"}


def test_classification_supports_combined_questions():
    assert rag_service.classify_question("How does the forecast work for product sales?") == "combined"
    assert (
        rag_service.classify_question("How are inventory recommendations calculated?")
        == "combined"
    )


def test_answer_includes_live_source(monkeypatch):
    monkeypatch.setattr(
        rag_service,
        "_live_evidence",
        lambda _: {"rows": [{"products_count": 20}], "source": "LIVE_DATABASE"},
    )
    monkeypatch.setattr(rag_service, "_document_evidence", lambda _: {"rows": []})
    monkeypatch.setattr(
        rag_service,
        "generate_grounded_answer",
        lambda question, context: "There are 20 products in the live database.",
    )

    result = rag_service.answer_question("How many products exist?")

    assert result["answer"].startswith("There are 20")
    assert result["provenance"]["liveData"] is True
    assert result["sources"][0]["type"] == "live_database"


def test_combined_answer_includes_both_sources(monkeypatch):
    monkeypatch.setattr(
        rag_service,
        "_live_evidence",
        lambda _: {"rows": [{"active_alerts": 1}], "source": "LIVE_DATABASE"},
    )
    monkeypatch.setattr(
        rag_service,
        "_document_evidence",
        lambda _: {
            "rows": [
                {
                    "title": "Inventory recommendation logic",
                    "document_key": "inventory-recommendations",
                    "similarity": 0.9,
                }
            ],
            "available": True,
        },
    )
    monkeypatch.setattr(
        rag_service,
        "generate_grounded_answer",
        lambda question, context: "One active alert is recorded; recommendations use forecast and trend evidence.",
    )

    result = rag_service.answer_question(
        "How does the inventory recommendation work for products with alerts?"
    )

    assert result["provenance"] == {
        "liveData": True,
        "documentation": True,
        "documentRetrievalAvailable": True,
    }
    assert {source["type"] for source in result["sources"]} == {
        "live_database",
        "documentation",
    }


def test_provider_without_key_is_explicit(monkeypatch):
    monkeypatch.delenv("AI_ANALYST_LLM_API_KEY", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    from rag_provider import ProviderUnavailable, generate_grounded_answer

    with pytest.raises(ProviderUnavailable, match="not configured"):
        generate_grounded_answer("question", "evidence")


def test_provider_sends_bearer_credentials_without_exposing_them(monkeypatch):
    seen = {}

    class Response:
        ok = True

        def json(self):
            return {"choices": [{"message": {"content": "Grounded answer"}}]}

    def fake_post(*args, **kwargs):
        seen["authorization"] = kwargs["headers"].get("Authorization", "")
        return Response()

    monkeypatch.setattr("rag_provider.requests.post", fake_post)
    monkeypatch.setenv("AI_ANALYST_LLM_API_KEY", "test-key")

    from rag_provider import generate_grounded_answer

    assert generate_grounded_answer("question", "evidence") == "Grounded answer"
    assert seen["authorization"].startswith("Bearer ")
    assert seen["authorization"].endswith("test-key")


@pytest.mark.parametrize(
    ("status_code", "expected"),
    [
        (400, "AI Analyst provider rejected the request"),
        (429, "AI Analyst provider is rate-limited; try again later"),
        (503, "AI Analyst provider is temporarily unavailable"),
    ],
)
def test_provider_errors_are_sanitized(monkeypatch, status_code, expected):
    class Response:
        ok = False

        def json(self):
            return {"error": {"message": "secret upstream detail"}}

    response = Response()
    response.status_code = status_code
    monkeypatch.setattr("rag_provider.requests.post", lambda *args, **kwargs: response)
    monkeypatch.setenv("AI_ANALYST_LLM_API_KEY", "test-key")

    from rag_provider import ProviderUnavailable, generate_grounded_answer

    with pytest.raises(ProviderUnavailable, match=expected):
        generate_grounded_answer("question", "evidence")


def test_provider_empty_choices_are_reported_as_empty_answer(monkeypatch):
    class Response:
        ok = True

        def json(self):
            return {"choices": []}

    monkeypatch.setattr("rag_provider.requests.post", lambda *args, **kwargs: Response())
    monkeypatch.setenv("AI_ANALYST_LLM_API_KEY", "test-key")

    from rag_provider import ProviderUnavailable, generate_grounded_answer

    with pytest.raises(ProviderUnavailable, match="empty answer"):
        generate_grounded_answer("question", "evidence")


def test_provider_invalid_json_is_reported_safely(monkeypatch):
    class Response:
        ok = True

        def json(self):
            raise ValueError("invalid json")

    monkeypatch.setattr("rag_provider.requests.post", lambda *args, **kwargs: Response())
    monkeypatch.setenv("AI_ANALYST_LLM_API_KEY", "test-key")

    from rag_provider import ProviderUnavailable, generate_grounded_answer

    with pytest.raises(ProviderUnavailable, match="invalid response"):
        generate_grounded_answer("question", "evidence")


def test_provider_timeout_is_reported_safely(monkeypatch):
    def raise_timeout(*args, **kwargs):
        raise requests.Timeout("upstream timeout")

    monkeypatch.setattr("rag_provider.requests.post", raise_timeout)
    monkeypatch.setenv("AI_ANALYST_LLM_API_KEY", "test-key")

    from rag_provider import ProviderUnavailable, generate_grounded_answer

    with pytest.raises(ProviderUnavailable, match="timed out"):
        generate_grounded_answer("question", "evidence")


def test_empty_retrieval_is_explicit(monkeypatch):
    monkeypatch.setattr(rag_service, "_live_evidence", lambda _: {"rows": []})
    monkeypatch.setattr(rag_service, "_document_evidence", lambda _: {"rows": []})

    with pytest.raises(rag_service.ProviderUnavailable):
        rag_service.answer_question("Explain an unknown topic")


def test_sql_injection_is_not_interpreted_as_sql(monkeypatch):
    seen = {}

    class Cursor:
        def execute(self, query, params=()):
            seen["query"] = query
            seen["params"] = params

        def fetchone(self):
            return {"products_count": 20}

    class CursorContext:
        def __enter__(self):
            return Cursor()

        def __exit__(self, *_args):
            return None

    monkeypatch.setattr(rag_service, "_cursor", lambda: CursorContext())
    result = rag_service._live_evidence("'; DROP TABLE products; --")

    assert result["rows"] == [{"products_count": 20}]
    assert "DROP TABLE" not in seen["query"]
    assert seen["params"] == ()
