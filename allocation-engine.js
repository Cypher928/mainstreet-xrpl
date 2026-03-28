/**
 * CAM Logic — Allocation Engine
 * Calculates Commercial Area Maintenance charges per tenant
 */

function runCAMAllocation(expenses, tenants) {
  return tenants.map((tenant) => {
    const proRata = tenant.leasedSqft / tenant.totalPropertySqft;

    // Filter out expenses in tenant's excluded categories
    const eligibleExpenses = expenses.filter(
      (expense) => !tenant.excludedCategories.includes(expense.category)
    );

    // Calculate each expense share and sum
    let totalAllocated = eligibleExpenses.reduce((sum, expense) => {
      return sum + expense.amount * proRata;
    }, 0);

    let capAdjustment = null;

    // Apply cap if defined: cap = base * (1 + capPercentage / 100)
    if (tenant.capPercentage !== undefined && tenant.capPercentage !== null) {
      const BASE_AMOUNT = 10000;
      const cap = BASE_AMOUNT * (1 + tenant.capPercentage / 100);
      if (totalAllocated > cap) {
        capAdjustment = totalAllocated - cap;
        totalAllocated = cap;
      }
    }

    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      proRataShare: parseFloat((proRata * 100).toFixed(4)) + "%",
      allocatedAmount: parseFloat(totalAllocated.toFixed(2)),
      capAdjustment: capAdjustment !== null ? parseFloat(capAdjustment.toFixed(2)) : null,
      capApplied: capAdjustment !== null,
    };
  });
}

module.exports = { runCAMAllocation };
