import pytest
import requests
from fastapi.testclient import TestClient

import app
import rag_service


client = TestClient(app.app)


@pytest.fixture(autouse=True)
def disable_planner_network_calls(monkeypatch):
    monkeypatch.setattr(
        rag_service,
        "plan_question",
        lambda _: (_ for _ in ()).throw(
            rag_service.ProviderUnavailable("planner disabled in unit tests")
        ),
    )


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


def test_validated_llm_plan_routes_sales_comparison(monkeypatch):
    monkeypatch.setattr(
        rag_service,
        "plan_question",
        lambda _: {
            "intent": "compare product sales",
            "requested_output": "Compare total sales",
            "entities": ["almonds", "milk"],
            "metrics": ["sales"],
            "evidence_sources": ["live_sql"],
            "retrieval_tasks": [
                {"kind": "sales_comparison", "entities": ["almonds", "milk"]}
            ],
            "decomposed": True,
            "clarification": None,
        },
    )

    plan, used_fallback = rag_service._validated_plan(
        "Which product sold more, almonds or milk?"
    )

    assert used_fallback is False
    assert plan.entities == ["almonds", "milk"]
    assert plan.retrieval_tasks[0].kind == "sales_comparison"


def test_planner_json_failure_uses_safe_legacy_fallback(monkeypatch):
    monkeypatch.setattr(
        rag_service,
        "plan_question",
        lambda _: (_ for _ in ()).throw(
            rag_service.ProviderUnavailable("malformed plan")
        ),
    )

    plan, used_fallback = rag_service._validated_plan(
        "Tell me about the updates on almonds."
    )

    assert used_fallback is True
    assert plan.evidence_sources == ["live_sql"]
    assert plan.retrieval_tasks[0].kind == "product_snapshot"


def test_llm_plan_can_request_both_sources_and_multiple_steps(monkeypatch):
    monkeypatch.setattr(
        rag_service,
        "plan_question",
        lambda _: {
            "intent": "explain product recommendation",
            "requested_output": "Explain the recommendation using inventory rules",
            "entities": ["almonds"],
            "metrics": ["recommendation", "sales"],
            "evidence_sources": ["live_sql", "vector_docs"],
            "retrieval_tasks": [
                {"kind": "product_snapshot", "entities": ["almonds"]},
                {"kind": "documentation", "entities": []},
            ],
            "decomposed": True,
            "clarification": None,
        },
    )
    monkeypatch.setattr(
        rag_service,
        "_planned_live_evidence",
        lambda plan: {
            "rows": [{"name": "Almonds", "sales": {"total_sales": 12}}],
            "product_specific": True,
            "product_found": True,
        },
    )
    monkeypatch.setattr(
        rag_service,
        "_planned_document_evidence",
        lambda question, plan: {
            "rows": [
                {
                    "id": "doc-1",
                    "title": "Inventory rules",
                    "document_key": "inventory-recommendations",
                    "content": "Rules",
                    "similarity": 0.91,
                }
            ],
            "available": True,
        },
    )
    seen = {}
    monkeypatch.setattr(
        rag_service,
        "generate_grounded_answer",
        lambda question, context: seen.update(context=context)
        or "The recommendation is grounded in the live product record and inventory rules.",
    )

    result = rag_service.answer_question(
        "Explain the recommendation for almonds using the inventory rules."
    )

    assert result["category"] == "combined"
    assert result["provenance"]["liveData"] is True
    assert result["provenance"]["documentation"] is True
    assert "LIVE_DATABASE:" in seen["context"]
    assert "DOCUMENTATION:" in seen["context"]


def test_validated_plan_rejects_untrusted_task_kind(monkeypatch):
    monkeypatch.setattr(
        rag_service,
        "plan_question",
        lambda _: {
            "intent": "execute query",
            "requested_output": "data",
            "entities": [],
            "evidence_sources": ["live_sql"],
            "retrieval_tasks": [{"kind": "arbitrary_sql", "entities": []}],
        },
    )

    plan, used_fallback = rag_service._validated_plan("show sales data")

    assert used_fallback is True
    assert plan.retrieval_tasks[0].kind == "sales_summary"


@pytest.mark.parametrize(
    "question",
    [
        "Tell me about the updates on almonds.",
        "What changed for almonds recently?",
        "Give me the latest update on almonds.",
        "How are almonds performing?",
        "Why is almonds marked for increase?",
        "Show recent sales and predictions for almonds.",
    ],
)


def test_product_update_questions_route_to_live_data(question):
    assert rag_service.classify_question(question) == "live_business_analytics"
    assert rag_service._extract_product_term(question) == "almonds"


def test_product_live_retrieval_matches_name_case_insensitively(monkeypatch):
    executed = []

    class Cursor:
        def execute(self, query, params=()):
            executed.append((query, params))

        def fetchone(self):
            if len(executed) == 1:
                return {
                    "id": "product-id",
                    "name": "Almonds",
                    "category": "Health",
                    "created_at": None,
                    "updated_at": None,
                }
            return {
                "id": "product-id",
                "name": "Almonds",
                "category": "Health",
                "product_created_at": None,
                "product_updated_at": None,
                "total_sales": 12,
                "sales_rows": 2,
                "latest_sale_at": "2026-05-01T00:00:00+00:00",
                "latest_prediction": {
                    "decision": "increase",
                    "predicted_at": "2026-05-02T00:00:00+00:00",
                },
                "alerts": [],
                "recent_sales": [],
            }

        def fetchall(self):
            return []

    class CursorContext:
        def __enter__(self):
            return Cursor()

        def __exit__(self, *_args):
            return None

    monkeypatch.setattr(rag_service, "_cursor", lambda: CursorContext())
    result = rag_service._live_evidence("How are ALMONDS performing?")

    assert result["product_found"] is True
    assert result["rows"][0]["name"] == "Almonds"
    assert executed[0][1] == ("ALMONDS",)
    assert all("%ALMONDS%" not in query for query, _ in executed)


def test_product_live_data_does_not_require_documentation(monkeypatch):
    live = {
        "rows": [
            {
                "name": "Almonds",
                "sales_rows": 2,
                "latest_prediction": {"decision": "increase"},
                "alerts": [],
            }
        ],
        "source": "LIVE_DATABASE",
        "product_specific": True,
        "product_term": "almonds",
        "product_found": True,
    }
    monkeypatch.setattr(rag_service, "_live_evidence", lambda _: live)
    monkeypatch.setattr(rag_service, "_document_evidence", lambda _: {"rows": []})
    monkeypatch.setattr(
        rag_service,
        "generate_grounded_answer",
        lambda question, context: "Almonds has a current increase recommendation.",
    )

    result = rag_service.answer_question("Tell me about the updates on almonds.")

    assert result["answer"].startswith("Almonds has")
    assert result["provenance"]["liveData"] is True
    assert result["provenance"]["documentation"] is False


def test_product_not_found_returns_explicit_limitation(monkeypatch):
    monkeypatch.setattr(
        rag_service,
        "_live_evidence",
        lambda _: {
            "rows": [],
            "product_specific": True,
            "product_term": "almonds",
            "product_found": False,
        },
    )
    monkeypatch.setattr(rag_service, "_document_evidence", lambda _: {"rows": []})

    result = rag_service.answer_question("Tell me about the updates on almonds.")

    assert "No matching product" in result["answer"]
    assert result["sources"] == []
    assert result["provenance"]["liveData"] is False


def test_product_without_activity_explains_missing_history(monkeypatch):
    monkeypatch.setattr(
        rag_service,
        "_live_evidence",
        lambda _: {
            "rows": [
                {
                    "name": "Almonds",
                    "sales_rows": 0,
                    "latest_prediction": None,
                    "alerts": [],
                }
            ],
            "product_specific": True,
            "product_term": "almonds",
            "product_found": True,
        },
    )
    monkeypatch.setattr(rag_service, "_document_evidence", lambda _: {"rows": []})
    monkeypatch.setattr(
        rag_service,
        "generate_grounded_answer",
        lambda *_: pytest.fail("provider must not be called without product activity"),
    )

    result = rag_service.answer_question("What changed for almonds recently?")

    assert "no sales, prediction, or alert history" in result["answer"]
    assert result["provenance"]["liveData"] is True


def test_product_combined_question_uses_live_and_documentation(monkeypatch):
    monkeypatch.setattr(
        rag_service,
        "_live_evidence",
        lambda _: {
            "rows": [
                {
                    "name": "Almonds",
                    "sales_rows": 2,
                    "latest_prediction": {"decision": "increase"},
                    "alerts": [],
                }
            ],
            "product_specific": True,
            "product_term": "almonds",
            "product_found": True,
        },
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
    seen = {}
    monkeypatch.setattr(
        rag_service,
        "generate_grounded_answer",
        lambda question, context: seen.update(context=context)
        or "The recommendation is grounded in the current product forecast and documented rules.",
    )

    result = rag_service.answer_question(
        "How does the recommendation work for almonds?"
    )

    assert result["category"] == "combined"
    assert result["provenance"] == {
        "liveData": True,
        "documentation": True,
        "documentRetrievalAvailable": True,
    }
    assert "LIVE_DATABASE:" in seen["context"]
    assert "DOCUMENTATION:" in seen["context"]


def test_product_question_with_no_sources_never_fabricates(monkeypatch):
    monkeypatch.setattr(
        rag_service,
        "_live_evidence",
        lambda _: {
            "rows": [],
            "product_specific": True,
            "product_term": "almonds",
            "product_found": False,
        },
    )
    monkeypatch.setattr(rag_service, "_document_evidence", lambda _: {"rows": []})
    monkeypatch.setattr(
        rag_service,
        "generate_grounded_answer",
        lambda *_: pytest.fail("provider must not be called without evidence"),
    )

    result = rag_service.answer_question("Give me the latest update on almonds.")

    assert "No matching product" in result["answer"]


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


def test_provider_accepts_structured_text_content(monkeypatch):
    class Response:
        ok = True

        def json(self):
            return {
                "choices": [
                    {
                        "message": {
                            "content": [
                                {"type": "text", "text": " Grounded "},
                                {"type": "text", "text": "answer "},
                            ]
                        },
                        "finish_reason": "stop",
                    }
                ]
            }

    monkeypatch.setattr("rag_provider.requests.post", lambda *args, **kwargs: Response())
    monkeypatch.setenv("AI_ANALYST_LLM_API_KEY", "test-key")

    from rag_provider import generate_grounded_answer

    assert generate_grounded_answer("question", "evidence") == "Grounded answer"


@pytest.mark.parametrize(
    "message",
    [
        {"content": None},
        {},
    ],
)
def test_provider_distinguishes_missing_and_null_content(monkeypatch, message):
    class Response:
        ok = True

        def json(self):
            return {"choices": [{"message": message, "finish_reason": "stop"}]}

    monkeypatch.setattr("rag_provider.requests.post", lambda *args, **kwargs: Response())
    monkeypatch.setenv("AI_ANALYST_LLM_API_KEY", "test-key")

    from rag_provider import ProviderUnavailable, generate_grounded_answer

    with pytest.raises(ProviderUnavailable, match="empty answer"):
        generate_grounded_answer("question", "evidence")


def test_provider_retries_one_empty_generation_then_succeeds(monkeypatch):
    responses = iter(
        [
            {"choices": [{"message": {"content": "   "}, "finish_reason": "stop"}]},
            {"choices": [{"message": {"content": "Recovered answer"}, "finish_reason": "stop"}]},
        ]
    )

    class Response:
        ok = True

        def json(self):
            return next(responses)

    calls = []
    monkeypatch.setattr(
        "rag_provider.requests.post",
        lambda *args, **kwargs: calls.append(kwargs) or Response(),
    )
    monkeypatch.setenv("AI_ANALYST_LLM_API_KEY", "test-key")

    from rag_provider import generate_grounded_answer

    assert generate_grounded_answer("question", "evidence") == "Recovered answer"
    assert len(calls) == 2


def test_provider_does_not_retry_http_validation_failure(monkeypatch):
    class Response:
        ok = False
        status_code = 400

        def json(self):
            return {"error": {"code": "invalid_request"}}

    calls = []
    monkeypatch.setattr(
        "rag_provider.requests.post",
        lambda *args, **kwargs: calls.append(kwargs) or Response(),
    )
    monkeypatch.setenv("AI_ANALYST_LLM_API_KEY", "test-key")

    from rag_provider import ProviderUnavailable, generate_grounded_answer

    with pytest.raises(ProviderUnavailable, match="rejected"):
        generate_grounded_answer("question", "evidence")
    assert len(calls) == 1


def test_provider_does_not_retry_token_limit_or_refusal(monkeypatch):
    for payload, expected in [
        (
            {"choices": [{"message": {"content": "partial"}, "finish_reason": "length"}]},
            "output limit",
        ),
        (
            {"choices": [{"message": {"refusal": "unsafe"}, "finish_reason": "stop"}]},
            "refused",
        ),
    ]:
        class Response:
            ok = True

            def json(self):
                return payload

        calls = []
        monkeypatch.setattr(
            "rag_provider.requests.post",
            lambda *args, **kwargs: calls.append(kwargs) or Response(),
        )
        monkeypatch.setenv("AI_ANALYST_LLM_API_KEY", "test-key")

        from rag_provider import ProviderUnavailable, generate_grounded_answer

        with pytest.raises(ProviderUnavailable, match=expected):
            generate_grounded_answer("question", "evidence")
        assert len(calls) == 1


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


def test_planner_malformed_json_is_reported_safely(monkeypatch):
    class Response:
        ok = True

        def json(self):
            return {"choices": [{"message": {"content": "not-json"}}]}

    monkeypatch.setattr("rag_provider.requests.post", lambda *args, **kwargs: Response())
    monkeypatch.setenv("AI_ANALYST_LLM_API_KEY", "test-key")

    from rag_provider import ProviderUnavailable, plan_question

    with pytest.raises(ProviderUnavailable, match="malformed JSON"):
        plan_question("compare sales")


def test_planner_timeout_is_reported_safely(monkeypatch):
    def raise_timeout(*args, **kwargs):
        raise requests.Timeout("upstream timeout")

    monkeypatch.setattr("rag_provider.requests.post", raise_timeout)
    monkeypatch.setenv("AI_ANALYST_LLM_API_KEY", "test-key")

    from rag_provider import ProviderUnavailable, plan_question

    with pytest.raises(ProviderUnavailable, match="timed out"):
        plan_question("compare sales")


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
