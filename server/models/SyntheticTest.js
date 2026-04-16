import mongoose from 'mongoose';

const testCaseSchema = new mongoose.Schema({
  prompt:           { type: String, required: true },
  systemPrompt:     { type: String },
  expectedCategory: { type: String },
  expectedTierMin:  { type: String },
  expectedTierMax:  { type: String },
  tags:             [{ type: String }],
}, { _id: true });

const testRunResultSchema = new mongoose.Schema({
  testCaseId:    { type: mongoose.Schema.Types.ObjectId },
  prompt:        { type: String },
  routedModel:   { type: String },
  routedTier:    { type: String },
  category:      { type: String },
  confidence:    { type: Number },
  overrides:     { type: String },
  selectionMethod: { type: String },
  routingMs:     { type: Number },
  tierMatch:     { type: Boolean },
  categoryMatch: { type: Boolean },
  expectedTierMin: { type: String },
  expectedTierMax: { type: String },
  expectedCategory: { type: String },
  reasoning:     { type: String },
  trace:         [{ step: String, name: String, changed: Boolean, detail: String }],
  // Tier progression — shows how the tier evolved through the pipeline
  classifierTier:   { type: String },  // what the classifier/pre-routing chose
  classifierModel:  { type: String },  // model at classifier tier
  afterOverrides:   { type: String },  // tier after overrides
  afterCostMode:    { type: String },  // tier after cost mode
  finalTier:        { type: String },  // tier after tier boost (= routedTier)
  finalModel:       { type: String },  // model at final tier (= routedModel)
}, { _id: false });

const testRunSchema = new mongoose.Schema({
  testSuiteId: { type: mongoose.Schema.Types.ObjectId, ref: 'SyntheticTest', required: true, index: true },
  tenantId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  ruleSetName: { type: String },
  results:     [testRunResultSchema],
  summary: {
    total:         { type: Number },
    tierMatches:   { type: Number },
    categoryMatches: { type: Number },
    avgConfidence: { type: Number },
    avgRoutingMs:  { type: Number },
    tierDistribution: { type: Map, of: Number },
  },
  // AI evaluation (optional — filled by evaluation endpoint)
  evaluation: {
    model:    { type: String },  // which model evaluated
    analysis: { type: String },  // full analysis text
    qualitySuggestions:  [{ type: String }],
    costSuggestions:     [{ type: String }],
    score:    { type: Number },  // 0-100 routing quality score
  },
  createdAt: { type: Date, default: Date.now },
});

const syntheticTestSchema = new mongoose.Schema({
  name:        { type: String, required: true },
  description: { type: String },
  category:    { type: String },  // optional: scope to a specific category
  testCases:   [testCaseSchema],
  createdAt:   { type: Date, default: Date.now },
  updatedAt:   { type: Date, default: Date.now },
});

export const TestRun = mongoose.model('TestRun', testRunSchema);
export default mongoose.model('SyntheticTest', syntheticTestSchema);
