//! Opt-in local AI gateway: providers, budgets, completions, sidecar bridge.

pub(crate) mod gateway;
mod secrets;

pub use gateway::{encrypt_provider_key, run_agent, test_provider, AgentRequest};
