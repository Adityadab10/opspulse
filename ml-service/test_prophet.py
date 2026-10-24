"""
Test script for Prophet demand prediction without Flask.
Run with: python test_prophet.py
"""

from predictionService import predict_demand
import sys


def run_prediction_test(product_id):
    """Test prediction for a given product ID."""
    print("\n" + "="*60)
    print(f"Testing Prophet Prediction for Product ID: {product_id}")
    print("="*60)
    
    try:
        prediction, min_value, max_value = predict_demand(product_id)
        
        print("\n✓ Prediction successful!")
        print("-"*60)
        print(f"  Predicted Demand (30 days): {prediction}")
        print(f"  Min Prediction:             {min_value}")
        print(f"  Max Prediction:             {max_value}")
        print("-"*60)
        
        return True
    
    except ValueError as e:
        print(f"\n✗ Validation Error: {str(e)}")
        print("-"*60)
        return False
    
    except Exception as e:
        print(f"\n✗ Unexpected Error: {str(e)}")
        print("-"*60)
        return False


if __name__ == "__main__":
    # Test with sample product IDs
    test_products = [
        "507f1f77bcf86cd799439011",  # Sample MongoDB ObjectId
        "PROD001",                     # Sample string ID
    ]
    
    print("\n" + "="*60)
    print("PROPHET DEMAND PREDICTION TEST SUITE")
    print("="*60)
    
    results = []
    for product_id in test_products:
        success = run_prediction_test(product_id)
        results.append((product_id, success))
    
    # Summary
    print("\n" + "="*60)
    print("TEST SUMMARY")
    print("="*60)
    for product_id, success in results:
        status = "PASSED ✓" if success else "FAILED ✗"
        print(f"  {product_id}: {status}")
    print("="*60 + "\n")
    
    # Exit with appropriate code
    sys.exit(0 if all(success for _, success in results) else 1)