function checkResults(needs) {
    if (needs.plan?.result !== 'success') { throw new Error('Verification plan did not succeed'); }
    const flags = needs.plan.outputs;
    for (const [job, flag] of [['build', 'code'], ['compatibility', 'full'], ['integration', 'database']]) {
        if (!['true', 'false'].includes(flags?.[flag])) { throw new Error(`Missing verification flag: ${flag}`); }
        const result = needs[job]?.result;
        if (flags[flag] === 'true' ? result !== 'success' : !['success', 'skipped'].includes(result)) {
            throw new Error(`Required verification did not succeed: ${job} (${result})`);
        }
    }
    return 'All required checks passed';
}
module.exports = { checkResults };
if (require.main === module) { console.log(checkResults(JSON.parse(process.env.CI_NEEDS))); }
