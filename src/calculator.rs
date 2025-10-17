///-------------------------------------------------------------------------------
///
/// This is your calculator implementation task
/// to practice enums, structs, and methods.
///
/// Complete the implementation of the Calculator struct and its methods.
///
/// The calculator should support basic arithmetic
/// operations (addition, subtraction, multiplication)
/// with overflow protection and maintain a history
/// of operations.
///
/// Tasks:
/// 1. Implement the OperationType enum methods
/// 2. Implement the Operation struct constructor
/// 3. Implement all Calculator methods
///
///-------------------------------------------------------------------------------

#[derive(Copy, Clone)]
pub enum OperationType {
    Addition,
    Subtraction,
    Multiplication,
}

impl OperationType {
    // TODO: Return the string representation of the operation sign
    // Addition -> "+", Subtraction -> "-", Multiplication -> "*"
    pub fn get_sign(&self) -> &str {
        match self {
            Self::Addition => "+",
            Self::Subtraction => "-",
            Self::Multiplication => "*",
        }
    }

    // TODO: Perform the operation on two i64 numbers with overflow protection
    // Return Some(result) on success, None on overflow
    //
    // Example: OperationType::Multiplication.perform(x, y)
    pub fn perform(&self, x: i64, y: i64) -> Option<i64> {
        match self {
            OperationType::Addition => x.checked_add(y),
            OperationType::Subtraction => x.checked_sub(y),
            OperationType::Multiplication => x.checked_mul(y),
        }
    }
}

#[derive(Clone)]
pub struct Operation {
    pub first_num: i64,
    pub second_num: i64,
    pub operation_type: OperationType,
}

impl Operation {
    // TODO: Create a new Operation with the given parameters
    pub fn new(first_num: i64, second_num: i64, operation_type: OperationType) -> Self {
        Self {
            first_num,
            second_num,
            operation_type,
        }
    }
}

pub struct Calculator {
    pub history: Vec<Operation>,
}

impl Calculator {
    // TODO: Create a new Calculator with empty history
    pub fn new() -> Self {
        Self {
            history: Vec::new(),
        }
    }

    // TODO: Perform addition and store successful operations in history
    // Return Some(result) on success, None on overflow
    pub fn addition(&mut self, x: i64, y: i64) -> Option<i64> {
        let result = OperationType::Addition.perform(x, y);
        if result.is_some() {
            self.history.push(Operation {
                first_num: x,
                second_num: y,
                operation_type: OperationType::Addition,
            });
        }
        result
    }

    // TODO: Perform subtraction and store successful operations in history
    // Return Some(result) on success, None on overflow
    pub fn subtraction(&mut self, x: i64, y: i64) -> Option<i64> {
        let result = OperationType::Subtraction.perform(x, y);
        if result.is_some() {
            self.history.push(Operation {
                first_num: x,
                second_num: y,
                operation_type: OperationType::Subtraction,
            })
        }
        result
    }

    // TODO: Perform multiplication and store successful operations in history
    // Return Some(result) on success, None on overflow
    pub fn multiplication(&mut self, x: i64, y: i64) -> Option<i64> {
        let result = OperationType::Multiplication.perform(x, y);
        if result.is_some() {
            self.history.push(Operation {
                first_num: x,
                second_num: y,
                operation_type: OperationType::Multiplication,
            })
        }
        result
    }

    // TODO: Generate a formatted string showing all operations in history
    // Format: "index: first_num operation_sign second_num = result\n"
    //
    // Example: "0: 5 + 3 = 8\n1: 10 - 2 = 8\n"
    pub fn show_history(&self) -> String {
        let mut out = String::new();
        for (idx, op) in self.history.iter().enumerate() {
            if let Some(result) = op.operation_type.perform(op.first_num, op.second_num) {
                out.push_str(&format!(
                    "{}: {} {} {} = {}\n",
                    &idx.to_string(),
                    op.first_num,
                    op.operation_type.get_sign(),
                    op.second_num,
                    result
                ));
            }
        }
        out
    }

    // TODO: Repeat an operation from history by index
    // Add the repeated operation to history and return the result
    // Return None if the index is invalid
    pub fn repeat(&mut self, operation_index: usize) -> Option<i64> {
        let (x, y, operation) = if let Some(op) = self.history.get(operation_index) {
            (op.first_num, op.second_num, op.operation_type)
        } else {
            return None;
        };

        let result = operation.perform(x, y);

        if result.is_some() {
            self.history.push(Operation {
                first_num: x,
                second_num: y,
                operation_type: operation,
            })
        }

        self.history[operation_index].operation_type.perform(
            self.history[operation_index].first_num,
            self.history[operation_index].second_num,
        )
    }

    // TODO: Clear all operations from history
    pub fn clear_history(&mut self) {
        self.history = Vec::new()
    }
}
