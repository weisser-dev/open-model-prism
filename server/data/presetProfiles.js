/**
 * Preset Routing Profiles
 * Named configuration bundles for common use-case patterns.
 * Each profile lists the routing categories that are most relevant.
 * Used by the setup wizard and the Apply Preset API.
 */

export const PRESET_PROFILES = [
  {
    id: 'software_development',
    name: 'Software Development',
    description: 'Optimize routing for coding, debugging, code review, SQL, DevOps, and architecture tasks',
    color: 'blue',
    icon: 'code',
    categories: [
      'coding_complex', 'coding_medium', 'coding_simple',
      'swe_agentic', 'sql_generation', 'devops_infrastructure',
      'qa_testing', 'code_security_review', 'system_design',
      'function_calling', 'data_transformation', 'api_integration',
    ],
  },
  {
    id: 'customer_support',
    name: 'Customer Support',
    description: 'Fast, friendly responses for chat support, email, FAQ, ticket triage, and classification',
    color: 'green',
    icon: 'headset',
    categories: [
      'smalltalk_simple', 'email_professional', 'classification_extraction',
      'conversation_roleplay', 'fact_check_verification', 'translation',
      'summarization_short', 'brainstorming', 'proofreading',
    ],
  },
  {
    id: 'research_analysis',
    name: 'Research & Analysis',
    description: 'Deep document analysis, scientific research, complex reasoning, and data interpretation',
    color: 'violet',
    icon: 'flask',
    categories: [
      'research_scientific', 'document_qa', 'analysis_complex', 'analysis_simple',
      'summarization_long', 'long_context_processing', 'data_analysis',
      'stem_science', 'reasoning_deep', 'reasoning_formal',
      'sensitive_critical', 'math_complex',
    ],
  },
  {
    id: 'creative_content',
    name: 'Creative Content',
    description: 'Marketing copy, blog posts, storytelling, brainstorming, and multilingual content',
    color: 'orange',
    icon: 'pencil',
    categories: [
      'creative_writing_long', 'creative_writing_short', 'brainstorming',
      'email_professional', 'conversation_roleplay', 'multilingual_complex',
      'summarization_short', 'proofreading', 'prompt_engineering',
    ],
  },
  {
    id: 'data_operations',
    name: 'Data & Operations',
    description: 'SQL generation, data transformation, statistics, math, and format conversion',
    color: 'teal',
    icon: 'chart',
    categories: [
      'sql_generation', 'data_transformation', 'data_analysis',
      'math_complex', 'math_simple', 'format_convert',
      'classification_extraction', 'instruction_following', 'function_calling',
    ],
  },
  {
    id: 'agentic_workflows',
    name: 'Agentic Workflows',
    description: 'Autonomous agents, tool use, multi-step planning, and API integrations',
    color: 'red',
    icon: 'robot',
    categories: [
      'tool_use_agentic', 'swe_agentic', 'planning_scheduling',
      'api_integration', 'function_calling', 'reasoning_formal',
      'coding_complex', 'system_design',
    ],
  },
  {
    id: 'general_all',
    name: 'General (All Categories)',
    description: 'Balanced coverage for all business use cases — enables all 45 categories',
    color: 'gray',
    icon: 'building',
    categories: [], // empty = all categories
  },
];
