# Simulated Real-Time Fraud Injection & Analysis Pipeline

An event-driven Change Data Capture (CDC) platform designed to simulate fintech transaction traffic, inject real-time synthetic fraud scenarios based on dynamic business rules, and analyze streaming changes for immediate detection and alerting.

---

## Architecture Overview

![System Architecture](./fraud_detection_architecture.jfif)

The system operates as an event-driven, decoupled streaming data pipeline using **Apache Kafka**, **PostgreSQL**, and **Debezium**:

1. **Data Ingestion & Persistence (Application Producer)**  
   The transaction producer continuously generates realistic financial transactions alongside simulated fraud scenarios. Events are written directly to the primary Kafka topic (`transactions`). **Consumer A** (Persistence Service) reads events from this topic and executes SQL `INSERT`/`UPDATE` queries to persist records into a **PostgreSQL** database.

2. **Change Data Capture (CDC)**  
   A **Debezium Source Connector** monitors the PostgreSQL database write-ahead logs (WAL) for table modifications. It transforms database row changes into CDC event envelopes and streams them into a secondary Kafka topic (`postgres.public.transactions`).

3. **Fraud Analysis & Alerting**  
   **Consumer B** (Fraud Detection Engine) subscribes to the CDC topic, parses updated row states, executes real-time fraud detection logic, and routes alerts downstream to an external Notification/Alerting System.

---

## Transaction Generation & Fraud Injection Engine

The producer service continuously generates transaction streams. Each generated transaction passes through a **Fraud Injection Engine** prior to publication. 

The engine uses rule-based configurations defined in `producer.yaml` to evaluate whether a transaction should proceed as a standard, legitimate transfer or be modified into a synthetic fraud scenario. The stream runs endlessly to mimic a live financial ecosystem.

---

## Configuration Guide (`producer.yaml`)

The `producer.yaml` configuration file controls transaction generation velocity, customer pool sizes, supported service types, statistical distributions, and fraud injection mechanics.

### 1. General Producer Settings
* **`throughput_tps`**: Sets the system throughput in transactions per second (TPS).
  * `1.0`: Generates 1 transaction per second.
  * `0.1`: Generates 1 transaction every 10 seconds.
* **`customers_count`**: Specifies the total size of the customer pool. To keep transaction history traceable, the system instantiates a fixed number of customer profiles and selects random customers from this pool per transaction.

### 2. Supported Financial Services
The system models three standard digital banking / digital wallet transaction types:
1. **Wallet Load**: Commonly exploited in scams where unauthorized bank access is used to move funds into digital wallets with lighter regulatory controls.
2. **P2P Transfer (`send_money`)**: Peer-to-peer user money transfers.
3. **Merchant Payment**: Direct payments made to commercial entities.

**Service Properties:**
* **Limits**: Each service defines specific `lower_limit` and `upper_limit` values for acceptable (normal) transaction amounts.
* **Statistical Distribution**: Transaction amounts are generated using specific distribution functions (`triangular`, `uniform`, or `beta`) to mimic real-world spending habits.

---

### 3. Fraud Injection Configurations
The engine modifies standard transactions into fraudulent ones based on global probabilities, weighting, and scenario-specific parameters:

* **`injection_probability`**: Global likelihood (range `0.0` to `1.0`) that a transaction will be flagged and mutated into a fraud event (e.g., `0.1` represents a 10% probability).
* **Scenario Weights**: Each fraud scenario is assigned a relative weight that dictates its probability of selection when a fraud event is triggered.

#### Fraud Scenarios:

1. **Scenario 1: Account Takeover (ATO)**  
   * **Behavior**: Simulates an unauthorized attacker accessing a legitimate user's account from unrecognized geolocations or IP addresses.
   * **Parameters**: 
     * `new_location_probability`: Likelihood of overriding the transaction location with an unfamiliar geographical location.
     * `new_ip_address_probability`: Likelihood of overriding the transaction IP with an unknown IP address.

2. **Scenario 2: Velocity Attack**  
   * **Behavior**: Simulates automated micro-burst fraud where a high volume of small or identical transaction amounts occur within a very short timeframe.
   * **Parameters**:
     * `transactions_count`: Min and max bounds controlling the number of transactions produced in a rapid burst.
     * `interval_seconds`: Time window in seconds over which the burst occurs.

3. **Scenario 3: SIM Swap Attack**  
   * **Behavior**: Simulates unauthorized access resulting from phone number hijackings, causing transactions to originate from unrecognized device hardware.
   * **Parameters**:
     * `new_device_probability`: Probability that the transaction's `device_id` will differ from the customer's registered primary device ID.

---
## Conclusion

By combining event-driven transaction streaming with Debezium Change Data Capture (CDC) and PostgreSQL, this pipeline provides a decoupled, low-latency foundation for real-time fraud detection without impacting primary database performance.

To explore the source code, deploy the infrastructure locally, or experiment with custom fraud scenarios, check out the project on [GitHub](https://github.com/MohanDhakal/Fraud-Detection-Pipeline).