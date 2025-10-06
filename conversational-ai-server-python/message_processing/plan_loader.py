"""
Plan loader for reading and parsing JSON conversation plans.
Supports loading plans from the plans/ directory and converting them to Plan objects.
"""
import json
import os
from typing import Dict, List, Any, Optional
from pathlib import Path

from .plan_models import (
    Plan, PlanStep, Deliverable, DeliverableType, StepType, ConditionalJump,
    StateMachinePlan, State, Task, StateType, TaskStatus, StateTransition
)


class PlanLoadError(Exception):
    """Raised when plan loading fails."""
    pass


class PlanValidationError(Exception):
    """Raised when plan validation fails."""
    pass


class PlanLoader:
    """Loads and validates conversation plans from JSON files."""

    def __init__(self, plans_directory: str = "plans"):
        """
        Initialize plan loader.

        Args:
            plans_directory: Directory containing plan JSON files (relative to project root)
        """
        # Use absolute path based on this file's location instead of working directory
        if not os.path.isabs(plans_directory):
            current_file_dir = os.path.dirname(os.path.abspath(__file__))
            project_root = os.path.dirname(current_file_dir)  # Go up one level from message_processing/
            absolute_plans_directory = os.path.join(project_root, plans_directory)
            self.plans_directory = Path(absolute_plans_directory)
        else:
            self.plans_directory = Path(plans_directory)

        self.loaded_plans: Dict[str, Plan] = {}
        self.loaded_state_machine_plans: Dict[str, StateMachinePlan] = {}

        # Verify plans directory exists
        if not self.plans_directory.exists():
            print(f"[PlanLoader] Warning - Plans directory does not exist: {self.plans_directory}")
        else:
            print(f"[PlanLoader] Plans directory found: {self.plans_directory}")

    def load_plan(self, plan_name: str) -> Plan:
        """
        Load a plan by name.

        Args:
            plan_name: Name of the plan (without .json extension)

        Returns:
            Plan object

        Raises:
            PlanLoadError: If plan file doesn't exist or can't be loaded
            PlanValidationError: If plan structure is invalid
        """
        # Check if already loaded
        if plan_name in self.loaded_plans:
            return self.loaded_plans[plan_name]

        # Construct file path
        plan_file = self.plans_directory / f"{plan_name}.json"

        if not plan_file.exists():
            # List available files for debugging
            if self.plans_directory.exists():
                available_files = list(self.plans_directory.glob("*.json"))
                print(f"[PlanLoader] Available plan files: {[f.name for f in available_files]}")
            raise PlanLoadError(f"Plan file not found: {plan_file}")

        try:
            # Load and parse JSON
            with open(plan_file, 'r', encoding='utf-8') as f:
                plan_data = json.load(f)

            # Validate and convert to Plan object
            plan = self._parse_plan(plan_data)

            # Cache the loaded plan
            self.loaded_plans[plan_name] = plan

            print(f"[PlanLoader] Loaded plan '{plan_name}': {plan.title} ({len(plan.steps)} steps)")
            return plan

        except json.JSONDecodeError as e:
            raise PlanLoadError(f"Invalid JSON in plan file {plan_file}: {e}")
        except Exception as e:
            raise PlanLoadError(f"Error loading plan {plan_name}: {e}")

    def _parse_plan(self, plan_data: Dict[str, Any]) -> Plan:
        """
        Parse plan data and validate structure.

        Args:
            plan_data: Raw plan data from JSON

        Returns:
            Plan object

        Raises:
            PlanValidationError: If plan structure is invalid
        """
        # Validate required fields
        required_fields = ['id', 'title', 'description', 'steps']
        for field in required_fields:
            if field not in plan_data:
                raise PlanValidationError(f"Missing required field: {field}")

        # Parse steps
        steps = []
        step_ids = set()

        if not isinstance(plan_data['steps'], list) or len(plan_data['steps']) == 0:
            raise PlanValidationError("Plan must have at least one step")

        for i, step_data in enumerate(plan_data['steps']):
            try:
                step = self._parse_step(step_data, i)

                # Check for duplicate step IDs
                if step.id in step_ids:
                    raise PlanValidationError(f"Duplicate step ID: {step.id}")
                step_ids.add(step.id)

                steps.append(step)
            except Exception as e:
                raise PlanValidationError(f"Error parsing step {i}: {e}")

        # Create plan
        plan = Plan(
            id=plan_data['id'],
            title=plan_data['title'],
            description=plan_data['description'],
            steps=steps,
            metadata=plan_data.get('metadata', {})
        )

        return plan

    def _parse_step(self, step_data: Dict[str, Any], step_index: int) -> PlanStep:
        """
        Parse a single step from JSON data.

        Args:
            step_data: Raw step data from JSON
            step_index: Index of step for error reporting

        Returns:
            PlanStep object

        Raises:
            PlanValidationError: If step structure is invalid
        """
        # Validate required step fields
        required_fields = ['id', 'type', 'title', 'instruction']
        for field in required_fields:
            if field not in step_data:
                raise PlanValidationError(f"Step {step_index} missing required field: {field}")

        # Validate step type
        try:
            step_type = StepType(step_data['type'])
        except ValueError:
            valid_types = [t.value for t in StepType]
            raise PlanValidationError(f"Step {step_index} has invalid type '{step_data['type']}'. Valid types: {valid_types}")

        # Parse deliverables
        deliverables = []
        deliverable_keys = set()

        for deliverable_data in step_data.get('deliverables', []):
            try:
                deliverable = self._parse_deliverable(deliverable_data)

                # Check for duplicate deliverable keys
                if deliverable.key in deliverable_keys:
                    raise PlanValidationError(f"Duplicate deliverable key in step {step_index}: {deliverable.key}")
                deliverable_keys.add(deliverable.key)

                deliverables.append(deliverable)
            except Exception as e:
                raise PlanValidationError(f"Error parsing deliverable in step {step_index}: {e}")

        # Determine auto-advance behavior
        auto_advance = step_type == StepType.STATEMENT or len(deliverables) == 0

        # Parse conditional jumps
        conditional_jumps = []
        for jump_data in step_data.get('conditional_jumps', []):
            try:
                conditional_jump = self._parse_conditional_jump(jump_data)
                conditional_jumps.append(conditional_jump)
            except Exception as e:
                raise PlanValidationError(f"Error parsing conditional jump in step {step_index}: {e}")

        return PlanStep(
            id=step_data['id'],
            type=step_type,
            title=step_data['title'],
            instruction=step_data['instruction'],
            deliverables=deliverables,
            auto_advance=auto_advance,
            conditional_jumps=conditional_jumps
        )

    def _parse_deliverable(self, deliverable_data: Dict[str, Any]) -> Deliverable:
        """
        Parse a deliverable from JSON data.

        Args:
            deliverable_data: Raw deliverable data from JSON

        Returns:
            Deliverable object

        Raises:
            PlanValidationError: If deliverable structure is invalid
        """
        # Validate required deliverable fields
        required_fields = ['key', 'type', 'description']
        for field in required_fields:
            if field not in deliverable_data:
                raise PlanValidationError(f"Deliverable missing required field: {field}")

        # Validate deliverable type
        try:
            deliverable_type = DeliverableType(deliverable_data['type'])
        except ValueError:
            valid_types = [t.value for t in DeliverableType]
            raise PlanValidationError(f"Deliverable has invalid type '{deliverable_data['type']}'. Valid types: {valid_types}")

        # Validate enum values if type is enum
        enum_values = deliverable_data.get('enum_values')
        if deliverable_type == DeliverableType.ENUM:
            if not enum_values or not isinstance(enum_values, list) or len(enum_values) == 0:
                raise PlanValidationError(f"Enum deliverable '{deliverable_data['key']}' must have non-empty enum_values list")

        return Deliverable(
            key=deliverable_data['key'],
            type=deliverable_type,
            description=deliverable_data['description'],
            required=deliverable_data.get('required', True),
            enum_values=enum_values,
            default_value=deliverable_data.get('default_value'),
            validation_pattern=deliverable_data.get('validation_pattern'),
            acceptance_criteria=deliverable_data.get('acceptance_criteria'),
            validation_rules=deliverable_data.get('validation_rules'),
            examples=deliverable_data.get('examples')
        )

    def _parse_conditional_jump(self, jump_data: Dict[str, Any]) -> ConditionalJump:
        """Parse a conditional jump from JSON data."""
        required_fields = ['condition_type', 'condition_deliverable', 'condition_value', 'target_step_id']
        for field in required_fields:
            if field not in jump_data:
                raise PlanValidationError(f"Conditional jump missing required field: {field}")

        return ConditionalJump(
            condition_type=jump_data['condition_type'],
            condition_deliverable=jump_data['condition_deliverable'],
            condition_value=jump_data['condition_value'],
            target_step_id=jump_data['target_step_id'],
            skip_intermediate=jump_data.get('skip_intermediate', True)
        )

    def list_available_plans(self) -> List[str]:
        """
        List all available plan names in the plans directory.

        Returns:
            List of plan names (without .json extension)
        """
        if not self.plans_directory.exists():
            return []

        plan_files = []
        for file_path in self.plans_directory.glob('*.json'):
            plan_files.append(file_path.stem)

        return sorted(plan_files)

    def validate_plan_file(self, plan_name: str) -> bool:
        """
        Validate a plan file without loading it.

        Args:
            plan_name: Name of the plan to validate

        Returns:
            True if valid, False otherwise
        """
        try:
            self.load_plan(plan_name)
            return True
        except (PlanLoadError, PlanValidationError) as e:
            print(f"[PlanLoader] Validation failed for plan '{plan_name}': {e}")
            return False

    def get_plan_info(self, plan_name: str) -> Optional[Dict[str, Any]]:
        """
        Get basic information about a plan without fully loading it.

        Args:
            plan_name: Name of the plan

        Returns:
            Plan info dict or None if plan doesn't exist
        """
        plan_file = self.plans_directory / f"{plan_name}.json"

        if not plan_file.exists():
            return None

        try:
            with open(plan_file, 'r', encoding='utf-8') as f:
                plan_data = json.load(f)

            return {
                'id': plan_data.get('id', plan_name),
                'title': plan_data.get('title', 'Unknown'),
                'description': plan_data.get('description', ''),
                'step_count': len(plan_data.get('steps', [])),
                'file_path': str(plan_file)
            }
        except Exception as e:
            print(f"[PlanLoader] Error getting info for plan '{plan_name}': {e}")
            return None

    def is_state_machine_plan(self, plan_name: str) -> bool:
        """
        Check if a plan is a state machine plan by examining its structure.

        Args:
            plan_name: Name of the plan

        Returns:
            True if it's a state machine plan, False if legacy plan
        """
        plan_file = self.plans_directory / f"{plan_name}.json"

        if not plan_file.exists():
            return False

        try:
            with open(plan_file, 'r', encoding='utf-8') as f:
                plan_data = json.load(f)

            # Check for state machine indicators
            return 'states' in plan_data and 'initial_state_id' in plan_data
        except Exception:
            return False

    def load_state_machine_plan(self, plan_name: str) -> StateMachinePlan:
        """
        Load a state machine plan by name.

        Args:
            plan_name: Name of the plan (without .json extension)

        Returns:
            StateMachinePlan object

        Raises:
            PlanLoadError: If plan file doesn't exist or can't be loaded
            PlanValidationError: If plan structure is invalid
        """
        # Check if already loaded
        if plan_name in self.loaded_state_machine_plans:
            return self.loaded_state_machine_plans[plan_name]

        # Construct file path
        plan_file = self.plans_directory / f"{plan_name}.json"

        if not plan_file.exists():
            raise PlanLoadError(f"Plan file not found: {plan_file}")

        try:
            # Load and parse JSON
            with open(plan_file, 'r', encoding='utf-8') as f:
                plan_data = json.load(f)

            # Validate and convert to StateMachinePlan object
            plan = self._parse_state_machine_plan(plan_data)

            # Cache the loaded plan
            self.loaded_state_machine_plans[plan_name] = plan

            print(f"[PlanLoader] Loaded state machine plan '{plan_name}': {plan.title} ({len(plan.states)} states)")
            return plan

        except json.JSONDecodeError as e:
            raise PlanLoadError(f"Invalid JSON in plan file {plan_file}: {e}")
        except Exception as e:
            raise PlanLoadError(f"Error loading state machine plan {plan_name}: {e}")

    def _parse_state_machine_plan(self, plan_data: Dict[str, Any]) -> StateMachinePlan:
        """
        Parse state machine plan data and validate structure.

        Args:
            plan_data: Raw plan data from JSON

        Returns:
            StateMachinePlan object

        Raises:
            PlanValidationError: If plan structure is invalid
        """
        # Validate required fields
        required_fields = ['id', 'title', 'description', 'states', 'initial_state_id']
        for field in required_fields:
            if field not in plan_data:
                raise PlanValidationError(f"Missing required field: {field}")

        # Parse states
        states = []
        state_ids = set()

        if not isinstance(plan_data['states'], list) or len(plan_data['states']) == 0:
            raise PlanValidationError("State machine plan must have at least one state")

        for i, state_data in enumerate(plan_data['states']):
            try:
                state = self._parse_state(state_data, i)

                # Check for duplicate state IDs
                if state.id in state_ids:
                    raise PlanValidationError(f"Duplicate state ID: {state.id}")
                state_ids.add(state.id)

                states.append(state)
            except Exception as e:
                raise PlanValidationError(f"Error parsing state {i}: {e}")

        # Validate initial_state_id exists
        if plan_data['initial_state_id'] not in state_ids:
            raise PlanValidationError(f"Initial state ID '{plan_data['initial_state_id']}' not found in states")

        # Create state machine plan
        plan = StateMachinePlan(
            id=plan_data['id'],
            title=plan_data['title'],
            description=plan_data['description'],
            states=states,
            initial_state_id=plan_data['initial_state_id'],
            metadata=plan_data.get('metadata', {})
        )

        return plan

    def _parse_state(self, state_data: Dict[str, Any], index: int) -> State:
        """
        Parse a single state from JSON data.

        Args:
            state_data: State data from JSON
            index: State index for error reporting

        Returns:
            State object

        Raises:
            PlanValidationError: If state structure is invalid
        """
        # Validate required fields
        required_fields = ['id', 'title', 'type', 'description', 'tasks']
        for field in required_fields:
            if field not in state_data:
                raise PlanValidationError(f"State {index}: Missing required field: {field}")

        # Parse state type
        try:
            state_type = StateType(state_data['type'])
        except ValueError:
            raise PlanValidationError(f"State {index}: Invalid state type: {state_data['type']}")

        # Parse tasks
        tasks = []
        task_ids = set()

        for j, task_data in enumerate(state_data['tasks']):
            try:
                task = self._parse_task(task_data, index, j)

                # Check for duplicate task IDs within state
                if task.id in task_ids:
                    raise PlanValidationError(f"State {index}: Duplicate task ID: {task.id}")
                task_ids.add(task.id)

                tasks.append(task)
            except Exception as e:
                raise PlanValidationError(f"State {index}, Task {j}: {e}")

        # Parse transitions
        transitions = []
        if 'transitions' in state_data:
            for k, transition_data in enumerate(state_data['transitions']):
                try:
                    transition = self._parse_state_transition(transition_data, index, k)
                    transitions.append(transition)
                except Exception as e:
                    raise PlanValidationError(f"State {index}, Transition {k}: {e}")

        return State(
            id=state_data['id'],
            title=state_data['title'],
            type=state_type,
            description=state_data['description'],
            tasks=tasks,
            transitions=transitions,
            metadata=state_data.get('metadata', {})
        )

    def _parse_task(self, task_data: Dict[str, Any], state_index: int, task_index: int) -> Task:
        """
        Parse a single task from JSON data.

        Args:
            task_data: Task data from JSON
            state_index: Parent state index for error reporting
            task_index: Task index for error reporting

        Returns:
            Task object

        Raises:
            PlanValidationError: If task structure is invalid
        """
        # Validate required fields
        required_fields = ['id', 'description', 'instruction']
        for field in required_fields:
            if field not in task_data:
                raise PlanValidationError(f"Missing required field: {field}")

        # Parse deliverables
        deliverables = []
        if 'deliverables' in task_data:
            for k, deliverable_data in enumerate(task_data['deliverables']):
                try:
                    deliverable = self._parse_deliverable(deliverable_data)
                    deliverables.append(deliverable)
                except Exception as e:
                    raise PlanValidationError(f"Deliverable {k}: {e}")

        return Task(
            id=task_data['id'],
            description=task_data['description'],
            instruction=task_data['instruction'],
            required=task_data.get('required', True),
            deliverables=deliverables,
            dependencies=task_data.get('dependencies', []),
            metadata=task_data.get('metadata', {})
        )

    def _parse_state_transition(self, transition_data: Dict[str, Any], state_index: int, transition_index: int) -> StateTransition:
        """
        Parse a single state transition from JSON data.

        Args:
            transition_data: Transition data from JSON
            state_index: Parent state index for error reporting
            transition_index: Transition index for error reporting

        Returns:
            StateTransition object

        Raises:
            PlanValidationError: If transition structure is invalid
        """
        # Validate required fields
        if 'target_state_id' not in transition_data:
            raise PlanValidationError("Missing required field: target_state_id")

        return StateTransition(
            target_state_id=transition_data['target_state_id'],
            condition_type=transition_data.get('condition_type'),
            condition_data=transition_data.get('condition_data'),
            priority=transition_data.get('priority', 0)
        )

    def load_plan_auto(self, plan_name: str):
        """
        Automatically detect plan type and load appropriate plan.

        Args:
            plan_name: Name of the plan

        Returns:
            Either Plan or StateMachinePlan object
        """
        if self.is_state_machine_plan(plan_name):
            return self.load_state_machine_plan(plan_name)
        else:
            return self.load_plan(plan_name)


# Global plan loader instance
_plan_loader = PlanLoader()

def get_plan_loader() -> PlanLoader:
    """Get the global plan loader instance."""
    return _plan_loader

def load_plan(plan_name: str) -> Plan:
    """Convenience function to load a plan."""
    return _plan_loader.load_plan(plan_name)

def list_plans() -> List[str]:
    """Convenience function to list available plans."""
    return _plan_loader.list_available_plans()

def load_state_machine_plan(plan_name: str) -> StateMachinePlan:
    """Convenience function to load a state machine plan."""
    return _plan_loader.load_state_machine_plan(plan_name)

def load_plan_auto(plan_name: str):
    """Convenience function to auto-detect and load appropriate plan type."""
    return _plan_loader.load_plan_auto(plan_name)

def is_state_machine_plan(plan_name: str) -> bool:
    """Convenience function to check if a plan is a state machine plan."""
    return _plan_loader.is_state_machine_plan(plan_name)