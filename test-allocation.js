const { runCAMAllocation } = require("./allocation-engine");

// --- Sample Expenses ---
const expenses = [
  { id: "e1", vendor: "CleanCo",      category: "janitorial",   amount: 8000 },
  { id: "e2", vendor: "LandscapeInc", category: "landscaping",  amount: 6000 },
  { id: "e3", vendor: "SecureGuard",  category: "security",     amount: 4000 },
  { id: "e4", vendor: "FixItFast",    category: "maintenance",  amount: 5000 },
  { id: "e5", vendor: "UtilityPlus",  category: "utilities",    amount: 9000 },
];

// Total property: 20,000 sqft
const tenants = [
  {
    id: "t1",
    name: "Sunrise Cafe",
    leasedSqft: 2000,
    totalPropertySqft: 20000,
    excludedCategories: [],           // No exclusions — pays full share
    capPercentage: null,
  },
  {
    id: "t2",
    name: "TechHub Office",
    leasedSqft: 5000,
    totalPropertySqft: 20000,
    excludedCategories: ["janitorial"], // Excluded from janitorial costs
    capPercentage: null,
  },
  {
    id: "t3",
    name: "MegaMart Retail",
    leasedSqft: 8000,
    totalPropertySqft: 20000,
    excludedCategories: ["landscaping", "security"], // Excluded from landscaping & security
    capPercentage: 20,                // Capped at 20% above base of $10,000 = $12,000 cap
  },
];

// --- Run Allocation ---
const results = runCAMAllocation(expenses, tenants);

// --- Print Results ---
console.log("==============================================");
console.log("        CAM Logic — Allocation Results       ");
console.log("==============================================\n");

results.forEach((r) => {
  console.log(`Tenant:           ${r.tenantName}`);
  console.log(`Pro-Rata Share:   ${r.proRataShare}`);
  console.log(`Allocated Amount: $${r.allocatedAmount.toLocaleString()}`);
  if (r.capApplied) {
    console.log(`Cap Applied:      YES — $${r.capAdjustment.toLocaleString()} was reduced`);
  } else {
    console.log(`Cap Applied:      No`);
  }
  console.log("----------------------------------------------\n");
});
