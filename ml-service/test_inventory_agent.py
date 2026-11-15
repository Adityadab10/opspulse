import unittest
from workflow.inventory_agent import prioritize


class InventoryAgentPrioritizationTests(unittest.TestCase):
    def state(self, products):
        return {"inventory_horizon_days": 30, "inventory_result": {"products": products, "limitations": []}}

    def test_prioritizes_stockout_and_proposes_approval_gated_replenishment(self):
        result = prioritize(self.state([{"id":"p1","name":"Widget","currentStock":2,"reorderThreshold":10,"expectedDemand":20,"forecastStatus":"available","forecastHorizonDays":30,"stockoutRisk":True,"recommendedReorderQuantity":18}]))
        recommendation = result["recommendations"][0]
        self.assertEqual(recommendation["riskClassification"], "stockout_risk")
        self.assertEqual(recommendation["suggestedReorderQuantity"], 18)
        self.assertEqual(recommendation["proposedAction"]["type"], "record_replenishment")
        self.assertTrue(recommendation["proposedAction"]["requiresApproval"])

    def test_missing_forecast_is_explicitly_limited(self):
        result = prioritize(self.state([{"id":"p1","name":"Widget","currentStock":2,"reorderThreshold":1,"expectedDemand":None,"forecastStatus":"missing"}]))
        recommendation = result["recommendations"][0]
        self.assertEqual(recommendation["riskClassification"], "forecast_missing")
        self.assertIsNone(recommendation["suggestedReorderQuantity"])
        self.assertIn("cannot receive demand-based recommendations", result["limitations"][0])

    def test_risks_are_sorted_by_urgency(self):
        result = prioritize(self.state([
            {"id":"low","name":"Low","currentStock":5,"reorderThreshold":10,"expectedDemand":1,"forecastStatus":"available","lowStock":True},
            {"id":"out","name":"Out","currentStock":0,"reorderThreshold":0,"expectedDemand":1,"forecastStatus":"available","stockoutRisk":True,"recommendedReorderQuantity":1},
        ]))
        self.assertEqual(result["recommendations"][0]["product"]["id"], "out")


if __name__ == "__main__":
    unittest.main()
